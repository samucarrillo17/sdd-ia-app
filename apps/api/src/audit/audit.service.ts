import { Injectable, Inject } from '@nestjs/common';
import { EntityManager, Repository } from 'typeorm';
import { AuditLog, AuditEntityType, AuditAction } from './audit-log.entity.js';

export interface AuditRecordInput {
  organizationId: string;
  actorUserId: string | null;
  entityType: AuditEntityType | string;
  entityId: string;
  action: AuditAction | string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  requestId?: string | null;
  ip?: string | null;
}

const SENSITIVE_FIELDS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'tokenhash',
  'token_hash',
  'hash',
  'secret',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'authorization',
  'cookie',
  'sid',
]);

function sanitizeObject(obj: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!obj) return null;

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();

    if (SENSITIVE_FIELDS.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map((item) =>
        item && typeof item === 'object' ? sanitizeObject(item as Record<string, unknown>) : item,
      );
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

@Injectable()
export class AuditService {
  constructor(
    @Inject('AUDIT_LOG_REPOSITORY')
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  /**
   * Registra una entrada de auditoría dentro de la transacción actual.
   * El manager recibido DEBE ser el de la transacción en curso para que
   * el cambio y su auditoría se confirmen o se reviertan juntos.
   */
  async record(manager: EntityManager, entry: AuditRecordInput): Promise<void> {
    const { before, after, ...rest } = entry;

    const auditLog = manager.create(AuditLog, {
      ...rest,
      before: sanitizeObject(before ?? null),
      after: sanitizeObject(after ?? null),
    });

    await manager.save(auditLog);
  }

  /**
   * Helper para crear before/after a partir de entidades TypeORM
   * (útil cuando se quiere auditar el estado completo antes/después)
   */
  static createBeforeAfter<T extends object>(
    beforeEntity: T | null,
    afterEntity: T,
    fieldsToInclude?: (keyof T)[],
  ): { before: Record<string, unknown> | null; after: Record<string, unknown> } {
    const pickFields = (entity: T): Record<string, unknown> => {
      const obj: Record<string, unknown> = {};
      const keys = fieldsToInclude ?? (Object.keys(entity) as (keyof T)[]);
      for (const key of keys) {
        obj[key as string] = entity[key];
      }
      return obj;
    };

    return {
      before: beforeEntity ? pickFields(beforeEntity) : null,
      after: pickFields(afterEntity),
    };
  }
}