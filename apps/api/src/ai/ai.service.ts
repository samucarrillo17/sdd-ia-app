import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource, Repository, In } from 'typeorm';
import { Request } from '../requests/entities/request.entity.js';
import { RequestItem } from '../requests/entities/request-item.entity.js';
import { Inventory } from '../inventory/inventory.entity.js';
import { Product } from '../products/product.entity.js';
import { User } from '../users/user.entity.js';
import { Role } from '../users/role.enum.js';
import { RequestStatus } from '../requests/enums/request-status.enum.js';
import { Priority } from '../requests/enums/priority.enum.js';
import { AuditService, AuditRecordInput } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit-log.entity.js';
import { EntityManager } from 'typeorm';
import { CreateSummaryDto } from './dto/create-summary.dto.js';
import { AiResponseDto, AiAction } from './dto/ai-response.dto.js';
import { AI_PROVIDER_TOKEN, type AiProvider, type AiSummaryInput } from './providers/ai-provider.interface.js';
import { priorityFallback, FallbackRequest } from './fallback/priority-fallback.js';

export enum FallbackReason {
  TIMEOUT = 'TIMEOUT',
  PROVIDER_ERROR = 'PROVIDER_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',
}

export interface SummaryResponse {
  source: 'ai' | 'fallback';
  fallbackReason: FallbackReason | null;
  summary: string;
  recommendations: Array<{
    requestId: string;
    rank: number;
    action: AiAction;
    reason: string;
  }>;
  generatedAt: string;
  requestCount: number;
}

interface AuthUser {
  id: string;
  organizationId: string;
  role: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    @Inject(AI_PROVIDER_TOKEN)
    private readonly aiProvider: AiProvider,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async summarize(user: AuthUser, dto: CreateSummaryDto): Promise<SummaryResponse> {
    const startTime = Date.now();
    const requests = await this.loadRequests(user, dto);

    if (requests.length === 0) {
      const result = this.buildResponse('fallback', null, {
        summary: 'No hay solicitudes ENVIADA pendientes para resumir.',
        recommendations: [],
      }, 0);
      await this.recordAudit(user, result, startTime);
      return result;
    }

    try {
      const input = this.buildAiInput(requests);
      const raw = await this.callWithTimeout(input);
      const parsed = await this.validateAiResponse(raw, requests.map(r => r.id));
      
      const result = this.buildResponse('ai', null, parsed, requests.length);
      await this.recordAudit(user, result, startTime);
      return result;
    } catch (err) {
      const reason = this.classifyError(err);
      this.logger.warn({ reason, error: err instanceof Error ? err.message : String(err) }, 'AI fallback activated');
      
      const fallback = priorityFallback(
        requests.map(r => this.toFallbackRequest(r)),
        new Date()
      );
      
      const result = this.buildResponse('fallback', reason, fallback, requests.length);
      await this.recordAudit(user, result, startTime);
      return result;
    }
  }

  private async loadRequests(user: AuthUser, dto: CreateSummaryDto): Promise<Array<Request & { items: (RequestItem & { product: Product })[] }>> {
    let requestIds = dto.requestIds;

    if (requestIds && requestIds.length > 0) {
      if (requestIds.length > 20) {
        throw new Error('MAX_REQUESTS_EXCEEDED');
      }
      
      const requests = await this.dataSource.getRepository(Request).find({
        where: {
          id: In(requestIds),
          organizationId: user.organizationId,
          status: RequestStatus.ENVIADA,
        },
        relations: { items: { product: true } },
      });

      if (requests.length !== requestIds.length) {
        throw new Error('INVALID_REQUESTS');
      }

      return requests;
    }

    // No requestIds provided: take 20 oldest ENVIADA by priority, neededBy, createdAt
    return this.dataSource.getRepository(Request).find({
      where: {
        organizationId: user.organizationId,
        status: RequestStatus.ENVIADA,
      },
      relations: { items: { product: true } },
      order: {
        priority: 'DESC', // ALTA > MEDIA > BAJA (enum order)
        neededBy: 'ASC',
        createdAt: 'ASC',
      },
      take: 20,
    });
  }

  private buildAiInput(requests: Array<Request & { items: (RequestItem & { product: Product })[] }>): AiSummaryInput {
    const now = new Date();
    return {
      requests: requests.map(req => ({
        id: req.id,
        code: req.code,
        priority: req.priority as 'ALTA' | 'MEDIA' | 'BAJA',
        neededBy: req.neededBy,
        items: req.items.map(item => ({
          sku: item.product.sku,
          name: item.product.name,
          quantity: item.quantity,
          available: 0, // Will be filled below
        })),
        notes: req.notes,
      })),
      now,
    };
  }

  private async callWithTimeout(input: AiSummaryInput): Promise<unknown> {
    // Fill in available stock for each item
    const productIds = [...new Set(input.requests.flatMap(r => r.items.map(i => i.sku)))];
    // We need to get available stock from inventory - but we don't have productId in the input
    // Let's enrich with actual data from the database
    const requestsWithStock = await this.enrichWithStock(input);
    
    const signal = AbortSignal.timeout(5000);
    return this.aiProvider.summarize(requestsWithStock, signal);
  }

  private async enrichWithStock(input: AiSummaryInput): Promise<AiSummaryInput> {
    // Get product IDs from SKUs
    const skus = [...new Set(input.requests.flatMap(r => r.items.map(i => i.sku)))];
    const products = await this.dataSource.getRepository(Product).find({
      where: { sku: In(skus) },
    });
    const productMap = new Map(products.map(p => [p.sku, p]));

    // Get inventory for these products
    const productIds = products.map(p => p.id);
    const inventories = await this.dataSource.getRepository(Inventory).find({
      where: { productId: In(productIds) },
    });
    const inventoryMap = new Map(inventories.map(inv => [inv.productId, inv]));

    return {
      ...input,
      requests: input.requests.map(req => ({
        ...req,
        items: req.items.map(item => {
          const product = productMap.get(item.sku);
          const inventory = product ? inventoryMap.get(product.id) : null;
          return {
            ...item,
            available: inventory ? inventory.onHand - inventory.reserved : 0,
          };
        }),
      })),
    };
  }

  private async validateAiResponse(raw: unknown, validRequestIds: string[]): Promise<AiResponseDto> {
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new Error('INVALID_JSON');
      }
    }

    const dto = plainToInstance(AiResponseDto, raw);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });

    if (errors.length > 0) {
      throw new Error('VALIDATION_FAILED');
    }

    // Additional validation: all requestIds must belong to the sent set, no duplicates
    const seenRequestIds = new Set<string>();
    const validIdSet = new Set(validRequestIds);

    for (const rec of dto.recommendations) {
      if (!validIdSet.has(rec.requestId)) {
        throw new Error('INVALID_REQUEST_ID');
      }
      if (seenRequestIds.has(rec.requestId)) {
        throw new Error('DUPLICATE_REQUEST_ID');
      }
      seenRequestIds.add(rec.requestId);
    }

    return dto;
  }

  private classifyError(err: unknown): FallbackReason {
    if (err instanceof Error) {
      if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.message.includes('Timeout') || err.message.includes('Aborted')) {
        return FallbackReason.TIMEOUT;
      }
      if (err.message === 'INVALID_JSON' || err.message === 'VALIDATION_FAILED' || err.message === 'INVALID_REQUEST_ID' || err.message === 'DUPLICATE_REQUEST_ID') {
        return FallbackReason.INVALID_RESPONSE;
      }
    }
    return FallbackReason.PROVIDER_ERROR;
  }

  private buildResponse(
    source: 'ai' | 'fallback',
    fallbackReason: FallbackReason | null,
    data: { summary: string; recommendations: Array<{ requestId: string; rank: number; action: string; reason: string }> },
    requestCount: number
  ): SummaryResponse {
    return {
      source,
      fallbackReason,
      summary: data.summary,
      recommendations: data.recommendations.map(r => ({
        requestId: r.requestId,
        rank: r.rank,
        action: r.action as AiAction,
        reason: r.reason,
      })),
      generatedAt: new Date().toISOString(),
      requestCount,
    };
  }

  private toFallbackRequest(req: Request & { items: (RequestItem & { product: Product })[] }): FallbackRequest {
    return {
      id: req.id,
      code: req.code,
      priority: req.priority,
      neededBy: req.neededBy,
      createdAt: req.createdAt,
      items: req.items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        available: 0, // Will need to be filled in service
      })),
      notes: req.notes,
    };
  }

  private async recordAudit(user: AuthUser, result: SummaryResponse, startTime: number): Promise<void> {
    const duration = Date.now() - startTime;
    this.logger.log({ source: result.source, fallbackReason: result.fallbackReason, requestCount: result.requestCount, durationMs: duration }, 'AI summary generated');

    await this.dataSource.transaction(async (manager: EntityManager) => {
      await this.auditService.record(manager, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        entityType: AuditEntityType.REQUEST,
        entityId: 'ai-summary',
        action: AuditAction.REQUEST_UPDATED, // Using existing action; could add AI_SUMMARY_GENERATED if needed
        requestId: null,
        after: {
          source: result.source,
          fallbackReason: result.fallbackReason,
          requestCount: result.requestCount,
          durationMs: duration,
        } as Record<string, unknown>,
      });
    });
  }
}