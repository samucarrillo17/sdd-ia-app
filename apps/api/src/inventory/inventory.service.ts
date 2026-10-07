import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { Inventory } from '../inventory/inventory.entity.js';
import { InventoryMovement, InventoryMovementType } from '../inventory/inventory-movement.entity.js';
import { Product } from '../products/product.entity.js';
import { Request } from '../requests/entities/request.entity.js';
import { RequestItem } from '../requests/entities/request-item.entity.js';
import { User } from '../users/user.entity.js';
import { Role } from '../users/role.enum.js';
import { applySorting, paginate } from '../common/utils/pagination.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';

export interface InventoryStockDto {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface InventoryListItemDto {
  productId: string;
  sku: string;
  name: string;
  onHand: number;
  reserved: number;
  available: number;
}

export interface ReserveItemsInput {
  requestId: string;
  organizationId: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface DispatchItemsInput {
  requestId: string;
  organizationId: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface ReleaseItemsInput {
  requestId: string;
  organizationId: string;
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
}

export interface InsufficientStockDetail {
  productId: string;
  sku: string;
  requested: number;
  available: number;
}

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(InventoryMovement)
    private readonly movementRepository: Repository<InventoryMovement>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(Request)
    private readonly requestRepository: Repository<Request>,
    @InjectRepository(RequestItem)
    private readonly requestItemRepository: Repository<RequestItem>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Obtiene el stock disponible para una lista de productos de una organización.
   */
  async getStock(organizationId: string, productIds: string[]): Promise<InventoryStockDto[]> {
    const inventories = await this.inventoryRepository.find({
      where: {
        organizationId,
        productId: In(productIds),
      },
      relations: { product: true },
    });

    const inventoryMap = new Map(inventories.map((inv) => [inv.productId, inv]));

    return productIds.map((productId) => {
      const inv = inventoryMap.get(productId);
      const product = inv?.product;
      return {
        productId,
        sku: product?.sku ?? 'N/A',
        name: product?.name ?? 'N/A',
        unit: product?.unit ?? 'und',
        onHand: inv?.onHand ?? 0,
        reserved: inv?.reserved ?? 0,
        available: inv ? inv.onHand - inv.reserved : 0,
      };
    });
  }

  /**
   * Reserva stock para los ítems de una solicitud (todo o nada).
   * Debe llamarse dentro de una transacción con las filas de inventory ya bloqueadas (SELECT FOR UPDATE).
   * Lanza ConflictException con detalle si hay stock insuficiente.
   */
  async reserveItems(
    manager: ReturnType<DataSource['createEntityManager']>,
    input: ReserveItemsInput,
  ): Promise<void> {
    const { requestId, organizationId, userId, items } = input;

    // Obtener productos para SKU en mensajes de error
    const productIds = items.map((i) => i.productId);
    const products = await manager.find(Product, {
      where: productIds.map((id) => ({ id, organizationId })),
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Verificar stock disponible para TODOS los ítems antes de modificar (todo o nada)
    const insufficient: InsufficientStockDetail[] = [];

    for (const item of items) {
      const inventory = await manager.findOne(Inventory, {
        where: { productId: item.productId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inventory) {
        const product = productMap.get(item.productId);
        insufficient.push({
          productId: item.productId,
          sku: product?.sku ?? 'N/A',
          requested: item.quantity,
          available: 0,
        });
        continue;
      }

      const available = inventory.onHand - inventory.reserved;
      if (available < item.quantity) {
        const product = productMap.get(item.productId);
        insufficient.push({
          productId: item.productId,
          sku: product?.sku ?? 'N/A',
          requested: item.quantity,
          available,
        });
      }
    }

    if (insufficient.length > 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock insuficiente para reservar',
        details: insufficient,
      });
    }

    // Stock suficiente para todos: proceder a reservar
    for (const item of items) {
      const inventory = await manager.findOne(Inventory, {
        where: { productId: item.productId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inventory) {
        // No debería pasar porque ya validamos arriba
        throw new NotFoundException({
          code: 'INVENTORY_NOT_FOUND',
          message: `Inventario no encontrado para producto ${item.productId}`,
        });
      }

      inventory.reserved += item.quantity;
      await manager.save(inventory);

      // Registrar movimiento en kardex
      const movement = manager.create(InventoryMovement, {
        organizationId,
        productId: item.productId,
        requestId,
        type: InventoryMovementType.RESERVA,
        quantity: item.quantity,
        createdBy: userId,
      });
      await manager.save(movement);
    }
  }

  /**
   * Despacha stock: reduce on_hand y reserved simultáneamente.
   * Debe llamarse dentro de transacción con filas bloqueadas.
   */
  async dispatchItems(
    manager: ReturnType<DataSource['createEntityManager']>,
    input: DispatchItemsInput,
  ): Promise<void> {
    const { requestId, organizationId, userId, items } = input;

    for (const item of items) {
      const inventory = await manager.findOne(Inventory, {
        where: { productId: item.productId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inventory) {
        throw new NotFoundException({
          code: 'INVENTORY_NOT_FOUND',
          message: `Inventario no encontrado para producto ${item.productId}`,
        });
      }

      if (inventory.reserved < item.quantity) {
        throw new ConflictException({
          code: 'INSUFFICIENT_RESERVED',
          message: `Stock reservado insuficiente para despachar`,
          details: [
            {
              productId: item.productId,
              reserved: inventory.reserved,
              requested: item.quantity,
            },
          ],
        });
      }

      inventory.onHand -= item.quantity;
      inventory.reserved -= item.quantity;
      await manager.save(inventory);

      // Registrar movimiento DESPACHO
      const movement = manager.create(InventoryMovement, {
        organizationId,
        productId: item.productId,
        requestId,
        type: InventoryMovementType.DESPACHO,
        quantity: item.quantity,
        createdBy: userId,
      });
      await manager.save(movement);
    }
  }

  /**
   * Libera reserva: reduce reserved (vuelve a disponible).
   * Usado al cancelar una solicitud en estado RESERVADA.
   */
  async releaseItems(
    manager: ReturnType<DataSource['createEntityManager']>,
    input: ReleaseItemsInput,
  ): Promise<void> {
    const { requestId, organizationId, userId, items } = input;

    for (const item of items) {
      const inventory = await manager.findOne(Inventory, {
        where: { productId: item.productId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inventory) {
        throw new NotFoundException({
          code: 'INVENTORY_NOT_FOUND',
          message: `Inventario no encontrado para producto ${item.productId}`,
        });
      }

      if (inventory.reserved < item.quantity) {
        throw new ConflictException({
          code: 'INSUFFICIENT_RESERVED',
          message: `No hay suficiente reserva para liberar`,
          details: [
            {
              productId: item.productId,
              reserved: inventory.reserved,
              requested: item.quantity,
            },
          ],
        });
      }

      inventory.reserved -= item.quantity;
      await manager.save(inventory);

      // Registrar movimiento LIBERACION
      const movement = manager.create(InventoryMovement, {
        organizationId,
        productId: item.productId,
        requestId,
        type: InventoryMovementType.LIBERACION,
        quantity: item.quantity,
        createdBy: userId,
      });
      await manager.save(movement);
    }
  }

  /**
   * Ajuste manual de inventario (para admins/auditores).
   * Crea movimiento tipo AJUSTE.
   */
  async adjustStock(
    organizationId: string,
    productId: string,
    deltaOnHand: number,
    userId: string,
    requestId?: string,
  ): Promise<Inventory> {
    return this.dataSource.transaction(async (manager) => {
      const inventory = await manager.findOne(Inventory, {
        where: { productId, organizationId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!inventory) {
        throw new NotFoundException({
          code: 'INVENTORY_NOT_FOUND',
          message: 'Inventario no encontrado',
        });
      }

      const newOnHand = inventory.onHand + deltaOnHand;
      if (newOnHand < 0) {
        throw new ConflictException({
          code: 'INVALID_ADJUSTMENT',
          message: 'El ajuste dejaría stock negativo',
        });
      }

      if (newOnHand < inventory.reserved) {
        throw new ConflictException({
          code: 'INVALID_ADJUSTMENT',
          message: 'El ajuste dejaría on_hand menor que reserved',
        });
      }

      inventory.onHand = newOnHand;
      await manager.save(inventory);

      // Registrar movimiento AJUSTE (quantity siempre positiva, el signo está en deltaOnHand)
      const movement = manager.create(InventoryMovement, {
        organizationId,
        productId,
        requestId: requestId ?? null,
        type: InventoryMovementType.AJUSTE,
        quantity: Math.abs(deltaOnHand),
        createdBy: userId,
      });
      await manager.save(movement);

      return inventory;
    });
  }

  /**
   * Obtiene el kardex (movimientos) de un producto en una organización.
   */
  async getKardex(
    organizationId: string,
    productId: string,
    limit = 100,
    offset = 0,
  ): Promise<InventoryMovement[]> {
    return this.movementRepository.find({
      where: { organizationId, productId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
      relations: { createdByUser: true, request: true },
    });
  }

  /**
   * Obtiene items de una solicitud con detalles de producto para operaciones de inventario.
   */
  async getRequestItemsForInventory(requestId: string, organizationId: string): Promise<
    Array<{
      productId: string;
      quantity: number;
      sku: string;
      name: string;
    }>
  > {
    const items = await this.requestItemRepository.find({
      where: { requestId },
      relations: { product: true },
    });

    // Verificar que todos los productos pertenecen a la organización
    for (const item of items) {
      if (item.product.organizationId !== organizationId) {
        throw new NotFoundException({
          code: 'REQUEST_NOT_FOUND',
          message: 'Solicitud no encontrada en esta organización',
        });
      }
    }

    return items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      sku: item.product.sku,
      name: item.product.name,
    }));
  }

  /**
   * Inicializa inventario para un producto (on_hand = 0, reserved = 0).
   * Se usa cuando se crea un producto nuevo.
   */
  async ensureInventoryExists(organizationId: string, productId: string): Promise<Inventory> {
    let inventory = await this.inventoryRepository.findOne({
      where: { organizationId, productId },
    });

    if (!inventory) {
      inventory = this.inventoryRepository.create({
        organizationId,
        productId,
        onHand: 0,
        reserved: 0,
      });
      await this.inventoryRepository.save(inventory);
    }

    return inventory;
  }

  /**
   * Lista inventario con filtros y paginación.
   * Devuelve: productId, sku, name, onHand, reserved, available.
   */
  async findAllPaginated(
    organizationId: string,
    dto: import('./dto/list-inventory-query.dto.js').ListInventoryQueryDto,
  ): Promise<PaginatedResponse<InventoryListItemDto>> {
    const qb = this.inventoryRepository.createQueryBuilder('inventory')
      .innerJoinAndSelect('inventory.product', 'product')
      .where('inventory.organizationId = :organizationId', { organizationId });

    if (dto.search) {
      qb.andWhere('(product.sku ILIKE :search OR product.name ILIKE :search)', { search: `%${dto.search}%` });
    }

    if (dto.lowStock) {
      qb.andWhere('(inventory.onHand - inventory.reserved) <= 10');
    }

    // Whitelist estricta de sortBy
    // Mapear campos del DTO a columnas reales
    const sortByMap: Record<string, string> = {
      sku: 'product.sku',
      name: 'product.name',
      onHand: 'inventory.onHand',
      reserved: 'inventory.reserved',
      available: 'inventory.onHand - inventory.reserved',
      createdAt: 'inventory.createdAt',
    };
    const sortByColumn = sortByMap[dto.sortBy ?? 'sku'] ?? 'product.sku';

    qb.orderBy(sortByColumn, dto.sortDir ?? 'ASC');
    qb.addOrderBy('inventory.id', 'ASC');

    // Paginación
    const { page, limit } = dto;
    const skip = (page - 1) * limit;
    qb.skip(skip).take(limit);

    const [data, total] = await qb.getManyAndCount();
    const totalPages = Math.ceil(total / limit);

    return {
      data: data.map((inv) => ({
        productId: inv.productId,
        sku: inv.product.sku,
        name: inv.product.name,
        onHand: inv.onHand,
        reserved: inv.reserved,
        available: inv.onHand - inv.reserved,
      })),
      meta: { page, limit, total, totalPages },
    };
  }
}