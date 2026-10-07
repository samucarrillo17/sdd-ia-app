import { Injectable, NotFoundException, ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { Request } from '../requests/entities/request.entity.js';
import { RequestItem } from '../requests/entities/request-item.entity.js';
import { Product } from '../products/product.entity.js';
import { User } from '../users/user.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { UpdateRequestDto } from './dto/update-request.dto.js';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto.js';
import { RequestResponseDto } from './dto/request-response.dto.js';
import { RequestItemResponseDto } from './dto/request-item-response.dto.js';
import { RequestStatus } from './enums/request-status.enum.js';
import { Role } from '../users/role.enum.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { IdempotencyService } from '../idempotency/idempotency.service.js';
import { canTransition, getCancelEffect } from './enums/request-transitions.js';
import { applySorting, paginate } from '../common/utils/pagination.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';
import { AuditLog } from '../audit/audit-log.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit-log.entity.js';

export interface CreateRequestResult {
  request: RequestResponseDto;
}

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

@Injectable()
export class RequestsService extends TenantScopedService {
  constructor(
    @InjectRepository(Request)
    private readonly requestRepository: Repository<Request>,
    @InjectRepository(RequestItem)
    private readonly requestItemRepository: Repository<RequestItem>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly inventoryService: InventoryService,
    private readonly idempotencyService: IdempotencyService,
    private readonly auditService: AuditService,
  ) {
    super();
  }

  async create(userId: string, dto: CreateRequestDto): Promise<CreateRequestResult> {
    return this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(User, { where: { id: userId } });
      if (!user) {
        throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Usuario no encontrado' });
      }

      const neededByDate = new Date(dto.neededBy);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (neededByDate < today) {
        throw new BadRequestException({ code: 'INVALID_NEEDED_BY', message: 'La fecha no puede ser pasada' });
      }

      const productIds = dto.items.map((item) => item.productId);
      const uniqueProductIds = new Set(productIds);
      if (uniqueProductIds.size !== productIds.length) {
        throw new BadRequestException({ code: 'DUPLICATE_PRODUCTS', message: 'Hay productos repetidos en la solicitud' });
      }

      const products = await manager.find(Product, {
        where: productIds.map((id) => ({ id, organizationId: user.organizationId, isActive: true })),
      });

      if (products.length !== productIds.length) {
        throw new NotFoundException({ code: 'INVALID_PRODUCTS', message: 'Uno o más productos no existen, no están activos o no pertenecen a su organización' });
      }

      const lastRequest = await manager.findOne(Request, {
        where: { organizationId: user.organizationId },
        order: { createdAt: 'DESC' },
      });
      const nextNumber = lastRequest ? parseInt(lastRequest.code.split('-')[1], 10) + 1 : 1;
      const code = `SOL-${nextNumber.toString().padStart(6, '0')}`;

      const request = manager.create(Request, {
        organizationId: user.organizationId,
        code,
        requesterId: userId,
        status: RequestStatus.BORRADOR,
        priority: dto.priority,
        neededBy: neededByDate,
        notes: dto.notes ?? null,
      });
      await manager.save(request);

      const items = dto.items.map((itemDto) => {
        const item = manager.create(RequestItem, {
          requestId: request.id,
          productId: itemDto.productId,
          quantity: itemDto.quantity,
        });
        return item;
      });
      await manager.save(items);

      const savedRequest = await manager.findOne(Request, {
        where: { id: request.id },
        relations: { items: { product: true } },
      });

      // Auditar creación de solicitud
      await this.auditService.record(manager, {
        organizationId: user.organizationId,
        actorUserId: userId,
        entityType: AuditEntityType.REQUEST,
        entityId: request.id,
        action: AuditAction.REQUEST_CREATED,
        after: { ...this.mapToResponseDto(savedRequest!) } as Record<string, unknown>,
      });

      return { request: this.mapToResponseDto(savedRequest!) };
    });
  }

  async findOne(requestId: string, user: AuthUser): Promise<RequestResponseDto> {
    const request = await this.findOneByTenant(this.requestRepository, user.organizationId, {
      where: { id: requestId },
      relations: { items: { product: true }, requester: true },
    });

    if (!request) {
      throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
    }

    if (user.role === Role.SOLICITANTE && request.requesterId !== user.id) {
      throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
    }

    return this.mapToResponseDto(request);
  }

  /**
   * Lista solicitudes con filtros y paginación.
   * SOLICITANTE solo ve sus propias solicitudes.
   * COORDINADOR, BODEGA, AUDITOR ven todas de su organización.
   */
  async findAll(dto: ListRequestsQueryDto, user: AuthUser): Promise<PaginatedResponse<RequestResponseDto>> {
    const qb = this.requestRepository.createQueryBuilder('request')
      .leftJoinAndSelect('request.items', 'items')
      .leftJoinAndSelect('items.product', 'product')
      .leftJoinAndSelect('request.requester', 'requester')
      .where('request.organizationId = :organizationId', { organizationId: user.organizationId });

    // SOLICITANTE solo ve las suyas
    if (user.role === Role.SOLICITANTE) {
      qb.andWhere('request.requesterId = :userId', { userId: user.id });
    }

    // Filtros
    if (dto.status && dto.status.length > 0) {
      qb.andWhere('request.status IN (:...status)', { status: dto.status });
    }

    if (dto.priority && dto.priority.length > 0) {
      qb.andWhere('request.priority IN (:...priority)', { priority: dto.priority });
    }

    if (dto.requesterId) {
      qb.andWhere('request.requesterId = :requesterId', { requesterId: dto.requesterId });
    }

    if (dto.neededFrom) {
      qb.andWhere('request.neededBy >= :neededFrom', { neededFrom: dto.neededFrom });
    }

    if (dto.neededTo) {
      qb.andWhere('request.neededBy <= :neededTo', { neededTo: dto.neededTo });
    }

    if (dto.createdFrom) {
      qb.andWhere('request.createdAt >= :createdFrom', { createdFrom: new Date(dto.createdFrom) });
    }

    if (dto.createdTo) {
      qb.andWhere('request.createdAt <= :createdTo', { createdTo: new Date(dto.createdTo) });
    }

    if (dto.search) {
      qb.andWhere('request.code ILIKE :search', { search: `%${dto.search}%` });
    }

    // Whitelist estricta de sortBy
    applySorting(qb, dto.sortBy, ['createdAt', 'neededBy', 'priority'], 'createdAt', dto.sortDir);

    // Paginación con orden determinista
    const result = await paginate(qb, dto, 'createdAt');

    // Mapear a DTOs de respuesta
    return {
      ...result,
      data: result.data.map((request) => this.mapToResponseDto(request)),
    };
  }

  /**
   * Historial de auditoría de una solicitud (atajo a /audit-logs filtrado por entidad).
   */
  async findHistory(requestId: string, dto: ListRequestsQueryDto, user: AuthUser): Promise<PaginatedResponse<any>> {
    // Primero verificar que la solicitud existe y el usuario tiene acceso
    await this.findOne(requestId, user);

    const qb = this.requestRepository.manager.createQueryBuilder(AuditLog, 'audit')
      .where('audit.organizationId = :organizationId', { organizationId: user.organizationId })
      .andWhere('audit.entityType = :entityType', { entityType: 'REQUEST' })
      .andWhere('audit.entityId = :entityId', { entityId: requestId });

    // Usar los mismos parámetros de paginación
    applySorting(qb, dto.sortBy, ['createdAt', 'entityType', 'action'], 'createdAt', dto.sortDir);

    const result = await paginate(qb, dto, 'createdAt');

    return result;
  }

  async update(requestId: string, userId: string, dto: UpdateRequestDto): Promise<RequestResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(Request, {
        where: { id: requestId },
        relations: { items: { product: true } },
      });

      if (!request) {
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
      }

      if (request.requesterId !== userId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No tiene permisos para editar esta solicitud' });
      }

      if (request.status !== RequestStatus.BORRADOR) {
        throw new ConflictException({ code: 'INVALID_STATE', message: 'Solo se pueden editar solicitudes en estado BORRADOR' });
      }

      // Capturar estado antes
      const beforeDto = this.mapToResponseDto(request);

      let neededByDate: Date | undefined;
      if (dto.neededBy) {
        neededByDate = new Date(dto.neededBy);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (neededByDate < today) {
          throw new BadRequestException({ code: 'INVALID_NEEDED_BY', message: 'La fecha no puede ser pasada' });
        }
      }

      if (dto.items) {
        const productIds = dto.items.map((item) => item.productId);
        const uniqueProductIds = new Set(productIds);
        if (uniqueProductIds.size !== productIds.length) {
          throw new BadRequestException({ code: 'DUPLICATE_PRODUCTS', message: 'Hay productos repetidos en la solicitud' });
        }

        const user = await manager.findOne(User, { where: { id: userId } });
        const products = await manager.find(Product, {
          where: productIds.map((id) => ({ id, organizationId: user!.organizationId, isActive: true })),
        });

        if (products.length !== productIds.length) {
          throw new NotFoundException({ code: 'INVALID_PRODUCTS', message: 'Uno o más productos no existen, no están activos o no pertenecen a su organización' });
        }

        await manager.delete(RequestItem, { requestId: request.id });

        const items = dto.items.map((itemDto) => {
          const item = manager.create(RequestItem, {
            requestId: request.id,
            productId: itemDto.productId,
            quantity: itemDto.quantity,
          });
          return item;
        });
        await manager.save(items);
      }

      request.priority = dto.priority ?? request.priority;
      if (neededByDate) {
        request.neededBy = neededByDate;
      }
      request.notes = dto.notes ?? request.notes;
      await manager.save(request);

      const updatedRequest = await manager.findOne(Request, {
        where: { id: request.id },
        relations: { items: { product: true } },
      });

      // Auditar actualización de solicitud
      await this.auditService.record(manager, {
        organizationId: request.organizationId,
        actorUserId: userId,
        entityType: AuditEntityType.REQUEST,
        entityId: request.id,
        action: AuditAction.REQUEST_UPDATED,
        before: { ...beforeDto } as Record<string, unknown>,
        after: { ...this.mapToResponseDto(updatedRequest!) } as Record<string, unknown>,
      });

      return this.mapToResponseDto(updatedRequest!);
    });
  }

  async delete(requestId: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(Request, {
        where: { id: requestId },
        relations: { items: { product: true } },
      });

      if (!request) {
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
      }

      if (request.requesterId !== userId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No tiene permisos para eliminar esta solicitud' });
      }

      if (request.status !== RequestStatus.BORRADOR) {
        throw new ConflictException({ code: 'INVALID_STATE', message: 'Solo se pueden eliminar solicitudes en estado BORRADOR' });
      }

      // Capturar estado antes para auditoría
      const beforeDto = this.mapToResponseDto(request);

      await manager.delete(Request, { id: requestId, organizationId: request.organizationId });

      // Auditar eliminación de solicitud
      await this.auditService.record(manager, {
        organizationId: request.organizationId,
        actorUserId: userId,
        entityType: AuditEntityType.REQUEST,
        entityId: requestId,
        action: AuditAction.REQUEST_DELETED,
        before: { ...beforeDto } as Record<string, unknown>,
      });
    });
  }

  async submit(requestId: string, userId: string): Promise<RequestResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      // Lock the request row first (without relations to avoid LEFT JOIN with FOR UPDATE)
      const request = await manager.findOne(Request, {
        where: { id: requestId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
      }

      if (request.requesterId !== userId) {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No tiene permisos para enviar esta solicitud' });
      }

      if (request.status !== RequestStatus.BORRADOR) {
        throw new ConflictException({ code: 'INVALID_STATE', message: 'Solo se pueden enviar solicitudes en estado BORRADOR' });
      }

      // Now load items and products separately
      const requestWithItems = await manager.findOne(Request, {
        where: { id: requestId },
        relations: { items: { product: true } },
      });

      if (!requestWithItems || !requestWithItems.items || requestWithItems.items.length === 0) {
        throw new BadRequestException({ code: 'EMPTY_ITEMS', message: 'La solicitud debe tener al menos 1 producto' });
      }

      if (requestWithItems.items.length > 10) {
        throw new BadRequestException({ code: 'TOO_MANY_ITEMS', message: 'La solicitud no puede tener más de 10 productos' });
      }

      const productIds = requestWithItems.items.map((item) => item.productId);
      const user = await manager.findOne(User, { where: { id: userId } });
      const products = await manager.find(Product, {
        where: productIds.map((id) => ({ id, organizationId: user!.organizationId, isActive: true })),
      });

      if (products.length !== productIds.length) {
        throw new NotFoundException({ code: 'INVALID_PRODUCTS', message: 'Uno o más productos ya no existen o no están activos' });
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const neededByDate = new Date(request.neededBy);
      if (neededByDate < today) {
        throw new BadRequestException({ code: 'INVALID_NEEDED_BY', message: 'La fecha no puede ser pasada' });
      }

      request.status = RequestStatus.ENVIADA;
      request.submittedAt = new Date();
      await manager.save(request);

      const updatedRequest = await manager.findOne(Request, {
        where: { id: request.id },
        relations: { items: { product: true } },
      });

      // Auditar envío de solicitud (BORRADOR → ENVIADA)
      await this.auditService.record(manager, {
        organizationId: request.organizationId,
        actorUserId: userId,
        entityType: AuditEntityType.REQUEST,
        entityId: request.id,
        action: AuditAction.REQUEST_SUBMITTED,
        before: { status: RequestStatus.BORRADOR, submittedAt: null },
        after: { status: RequestStatus.ENVIADA, submittedAt: updatedRequest!.submittedAt },
      });

      return this.mapToResponseDto(updatedRequest!);
    });
  }

  /**
   * Reserva stock para una solicitud (ENVIADA → RESERVADA).
   * Requiere Idempotency-Key (manejada por interceptor).
   * Rol: COORDINADOR.
   */
  async reserve(requestId: string, user: AuthUser, idempotencyKey: string, requestBody: unknown): Promise<RequestResponseDto> {
    const endpoint = `POST /requests/${requestId}/reserve`;
    const requestHash = IdempotencyService.generateRequestHash('POST', endpoint, requestBody);

    return this.idempotencyService.runIdempotent({
      key: idempotencyKey,
      endpoint,
      organizationId: user.organizationId,
      requestHash,
      fn: async (manager) => {
        // 1. Bloquear solicitud con pesimistic_write
        const request = await manager.findOne(Request, {
          where: { id: requestId, organizationId: user.organizationId },
          relations: { items: { product: true } },
          lock: { mode: 'pessimistic_write' },
        });

        if (!request) {
          throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
        }

        // 2. Validar transición ENVIADA → RESERVADA
        if (!canTransition(request.status, RequestStatus.RESERVADA)) {
          throw new ConflictException({
            code: 'INVALID_STATE_TRANSITION',
            message: `No se puede reservar desde estado ${request.status}`,
          });
        }

        // 3. Obtener items y bloquear inventory en orden determinista (product_id ASC)
        const items = await this.inventoryService.getRequestItemsForInventory(requestId, user.organizationId);
        const productIds = items.map((i) => i.productId).sort(); // ASC para evitar deadlocks

        // Bloquear filas de inventory en orden
        await manager.createQueryBuilder(Inventory, 'i')
          .setLock('pessimistic_write')
          .where('i.organization_id = :org AND i.product_id IN (:...ids)', { org: user.organizationId, ids: productIds })
          .orderBy('i.product_id', 'ASC')
          .getMany();

        // 4. Reservar stock (todo o nada) - usa inventoryService.reserveItems
        await this.inventoryService.reserveItems(manager, {
          requestId,
          organizationId: user.organizationId,
          userId: user.id,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        });

        // 5. Cambiar estado a RESERVADA
        request.status = RequestStatus.RESERVADA;
        await manager.save(request);

        // Auditar reserva de stock (ENVIADA → RESERVADA)
        await this.auditService.record(manager, {
          organizationId: user.organizationId,
          actorUserId: user.id,
          entityType: AuditEntityType.REQUEST,
          entityId: request.id,
          action: AuditAction.REQUEST_RESERVED,
          before: { status: RequestStatus.ENVIADA },
          after: { 
            status: RequestStatus.RESERVADA,
            reservedItems: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
          },
        });

        // 6. Retornar respuesta
        const updatedRequest = await manager.findOne(Request, {
          where: { id: request.id },
          relations: { items: { product: true } },
        });

        return {
          status: 200,
          body: this.mapToResponseDto(updatedRequest!),
        };
      },
    }).then((result) => result.body);
  }

  /**
   * Despacha una solicitud (RESERVADA → DESPACHADA).
   * Rol: BODEGA.
   */
  async dispatch(requestId: string, user: AuthUser): Promise<RequestResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(Request, {
        where: { id: requestId, organizationId: user.organizationId },
        relations: { items: { product: true } },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
      }

      if (!canTransition(request.status, RequestStatus.DESPACHADA)) {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          message: `No se puede despachar desde estado ${request.status}`,
        });
      }

      // Obtener items y bloquear inventory en orden determinista
      const items = await this.inventoryService.getRequestItemsForInventory(requestId, user.organizationId);
      const productIds = items.map((i) => i.productId).sort();

      await manager.createQueryBuilder(Inventory, 'i')
        .setLock('pessimistic_write')
        .where('i.organization_id = :org AND i.product_id IN (:...ids)', { org: user.organizationId, ids: productIds })
        .orderBy('i.product_id', 'ASC')
        .getMany();

      await this.inventoryService.dispatchItems(manager, {
        requestId,
        organizationId: user.organizationId,
        userId: user.id,
        items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      });

      request.status = RequestStatus.DESPACHADA;
      await manager.save(request);

      // Auditar despacho (RESERVADA → DESPACHADA)
      await this.auditService.record(manager, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        entityType: AuditEntityType.REQUEST,
        entityId: request.id,
        action: AuditAction.REQUEST_DISPATCHED,
        before: { status: RequestStatus.RESERVADA },
        after: { 
          status: RequestStatus.DESPACHADA,
          dispatchedItems: items.map(i => ({ productId: i.productId, quantity: i.quantity })),
        },
      });

      const updatedRequest = await manager.findOne(Request, {
        where: { id: request.id },
        relations: { items: { product: true } },
      });

      return this.mapToResponseDto(updatedRequest!);
    });
  }

  /**
   * Marca como entregada (DESPACHADA → ENTREGADA).
   * Rol: COORDINADOR, BODEGA.
   */
  async deliver(requestId: string, user: AuthUser): Promise<RequestResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(Request, {
        where: { id: requestId, organizationId: user.organizationId },
        relations: { items: { product: true } },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
      }

      if (!canTransition(request.status, RequestStatus.ENTREGADA)) {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          message: `No se puede marcar como entregada desde estado ${request.status}`,
        });
      }

      request.status = RequestStatus.ENTREGADA;
      await manager.save(request);

      // Auditar entrega (DESPACHADA → ENTREGADA)
      await this.auditService.record(manager, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        entityType: AuditEntityType.REQUEST,
        entityId: request.id,
        action: AuditAction.REQUEST_DELIVERED,
        before: { status: RequestStatus.DESPACHADA },
        after: { status: RequestStatus.ENTREGADA },
      });

      const updatedRequest = await manager.findOne(Request, {
        where: { id: request.id },
        relations: { items: { product: true } },
      });

      return this.mapToResponseDto(updatedRequest!);
    });
  }

  /**
   * Cancela una solicitud según tabla de transiciones.
   * - BORRADOR/ENVIADA: SOLICITANTE (propia) o COORDINADOR
   * - RESERVADA: COORDINADOR (libera stock)
   * - DESPACHADA/ENTREGADA/CANCELADA: no se puede cancelar
   */
  async cancel(requestId: string, user: AuthUser): Promise<RequestResponseDto> {
    return this.dataSource.transaction(async (manager) => {
      const request = await manager.findOne(Request, {
        where: { id: requestId, organizationId: user.organizationId },
        relations: { items: { product: true } },
        lock: { mode: 'pessimistic_write' },
      });

      if (!request) {
        throw new NotFoundException({ code: 'REQUEST_NOT_FOUND', message: 'Solicitud no encontrada' });
      }

      // Verificar permisos según estado
      const { canCancel, releasesStock } = getCancelEffect(request.status);
      
      if (!canCancel) {
        throw new ConflictException({
          code: 'INVALID_STATE_TRANSITION',
          message: `No se puede cancelar desde estado ${request.status}`,
        });
      }

      // SOLICITANTE solo puede cancelar sus propias solicitudes en BORRADOR/ENVIADA
      if (user.role === Role.SOLICITANTE) {
        if (request.requesterId !== user.id) {
          throw new ForbiddenException({ code: 'FORBIDDEN', message: 'No tiene permisos para cancelar esta solicitud' });
        }
        if (request.status !== RequestStatus.BORRADOR && request.status !== RequestStatus.ENVIADA) {
          throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Solo puede cancelar solicitudes en BORRADOR o ENVIADA' });
        }
      }

      // Si libera stock (RESERVADA → CANCELADA), bloquear inventory y liberar
      if (releasesStock) {
        const items = await this.inventoryService.getRequestItemsForInventory(requestId, user.organizationId);
        const productIds = items.map((i) => i.productId).sort();

        await manager.createQueryBuilder(Inventory, 'i')
          .setLock('pessimistic_write')
          .where('i.organization_id = :org AND i.product_id IN (:...ids)', { org: user.organizationId, ids: productIds })
          .orderBy('i.product_id', 'ASC')
          .getMany();

        await this.inventoryService.releaseItems(manager, {
          requestId,
          organizationId: user.organizationId,
          userId: user.id,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
        });
      }

      request.status = RequestStatus.CANCELADA;
      await manager.save(request);

      // Auditar cancelación
      const cancelDetails: Record<string, unknown> = {
        status: RequestStatus.CANCELADA,
      };
      if (releasesStock) {
        const items = await this.inventoryService.getRequestItemsForInventory(requestId, user.organizationId);
        cancelDetails.releasedItems = items.map(i => ({ productId: i.productId, quantity: i.quantity }));
      }

      await this.auditService.record(manager, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        entityType: AuditEntityType.REQUEST,
        entityId: request.id,
        action: AuditAction.REQUEST_CANCELLED,
        before: { status: request.status },
        after: cancelDetails,
      });

      const updatedRequest = await manager.findOne(Request, {
        where: { id: request.id },
        relations: { items: { product: true } },
      });

      return this.mapToResponseDto(updatedRequest!);
    });
  }

  private mapToResponseDto(request: Request): RequestResponseDto {
    const dto = new RequestResponseDto();
    dto.id = request.id;
    dto.code = request.code;
    dto.requesterId = request.requesterId;
    dto.status = request.status;
    dto.priority = request.priority;
    dto.neededBy = request.neededBy;
    dto.notes = request.notes;
    dto.submittedAt = request.submittedAt;
    dto.createdAt = request.createdAt;
    dto.updatedAt = request.updatedAt;
    dto.items = (request.items ?? []).map((item) => {
      const itemDto = new RequestItemResponseDto();
      itemDto.id = item.id;
      itemDto.productId = item.productId;
      itemDto.quantity = item.quantity;
      itemDto.product = {
        id: item.product.id,
        sku: item.product.sku,
        name: item.product.name,
        unit: item.product.unit,
      };
      return itemDto;
    });
    return dto;
  }
}

// Import Inventory at the top for the queryBuilder
import { Inventory } from '../inventory/inventory.entity.js';