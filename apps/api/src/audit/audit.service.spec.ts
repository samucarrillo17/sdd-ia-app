import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditService } from './audit.service.js';
import { EntityManager } from 'typeorm';
import { AuditLog } from './audit-log.entity.js';

describe('AuditService', () => {
  let service: AuditService;
  let mockManager: Partial<EntityManager>;

  beforeEach(() => {
    mockManager = {
      create: vi.fn().mockImplementation((entityClass, data) => data),
      save: vi.fn(),
    };
    service = new AuditService({} as any); // repository not used in record()
  });

  describe('record', () => {
    it('should sanitize password fields in before and after', async () => {
      const before = { password: 'secret123', email: 'test@test.com', passwordHash: 'hash' };
      const after = { password: 'newsecret', email: 'test@test.com' };

      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'USER',
        entityId: 'entity-1',
        action: 'USER_UPDATED',
        before,
        after,
        requestId: 'req-1',
        ip: '127.0.0.1',
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: expect.objectContaining({
          password: '[REDACTED]',
          passwordHash: '[REDACTED]',
          email: 'test@test.com',
        }),
        after: expect.objectContaining({
          password: '[REDACTED]',
          email: 'test@test.com',
        }),
      }));
    });

    it('should sanitize token fields', async () => {
      const before = { token: 'abc123', tokenHash: 'hash', accessToken: 'access', refreshToken: 'refresh' };
      const after = { token: 'newtoken' };

      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'SESSION',
        entityId: 'entity-1',
        action: 'LOGIN',
        before,
        after,
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: expect.objectContaining({
          token: '[REDACTED]',
          tokenHash: '[REDACTED]',
          accessToken: '[REDACTED]',
          refreshToken: '[REDACTED]',
        }),
        after: expect.objectContaining({
          token: '[REDACTED]',
        }),
      }));
    });

    it('should sanitize nested objects', async () => {
      const before = { user: { password: 'nested', name: 'John' } };
      const after = { user: { password: 'newnested', name: 'Jane' } };

      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'USER',
        entityId: 'entity-1',
        action: 'USER_UPDATED',
        before,
        after,
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: expect.objectContaining({
          user: expect.objectContaining({
            password: '[REDACTED]',
            name: 'John',
          }),
        }),
        after: expect.objectContaining({
          user: expect.objectContaining({
            password: '[REDACTED]',
            name: 'Jane',
          }),
        }),
      }));
    });

    it('should sanitize arrays of objects', async () => {
      const before = { items: [{ secret: 's1' }, { secret: 's2' }] };
      const after = { items: [{ secret: 's3' }] };

      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'TEST',
        entityId: 'entity-1',
        action: 'TEST_ACTION',
        before,
        after,
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ secret: '[REDACTED]' }),
            expect.objectContaining({ secret: '[REDACTED]' }),
          ]),
        }),
        after: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ secret: '[REDACTED]' }),
          ]),
        }),
      }));
    });

    it('should handle null before/after', async () => {
      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'REQUEST',
        entityId: 'entity-1',
        action: 'REQUEST_CREATED',
        before: null,
        after: { code: 'SOL-0001' },
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: null,
        after: expect.objectContaining({ code: 'SOL-0001' }),
      }));
    });

    it('should handle undefined before/after', async () => {
      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'REQUEST',
        entityId: 'entity-1',
        action: 'REQUEST_CREATED',
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: null,
        after: null,
      }));
    });

    it('should preserve non-sensitive fields', async () => {
      const before = { code: 'SOL-0001', status: 'BORRADOR', priority: 'ALTA' };
      const after = { code: 'SOL-0001', status: 'ENVIADA', priority: 'ALTA' };

      await service.record(mockManager as EntityManager, {
        organizationId: 'org-1',
        actorUserId: 'user-1',
        entityType: 'REQUEST',
        entityId: 'entity-1',
        action: 'REQUEST_SUBMITTED',
        before,
        after,
      });

      expect(mockManager.create).toHaveBeenCalledWith(AuditLog, expect.objectContaining({
        before: expect.objectContaining({ code: 'SOL-0001', status: 'BORRADOR', priority: 'ALTA' }),
        after: expect.objectContaining({ code: 'SOL-0001', status: 'ENVIADA', priority: 'ALTA' }),
      }));
    });
  });

  describe('createBeforeAfter', () => {
    it('should create before/after from entities', () => {
      const beforeEntity = { id: '1', code: 'SOL-0001', status: 'BORRADOR', priority: 'ALTA' };
      const afterEntity = { id: '1', code: 'SOL-0001', status: 'ENVIADA', priority: 'ALTA' };

      const result = AuditService.createBeforeAfter(beforeEntity, afterEntity);

      expect(result.before).toEqual({ id: '1', code: 'SOL-0001', status: 'BORRADOR', priority: 'ALTA' });
      expect(result.after).toEqual({ id: '1', code: 'SOL-0001', status: 'ENVIADA', priority: 'ALTA' });
    });

    it('should handle null beforeEntity', () => {
      const afterEntity = { id: '1', code: 'SOL-0001', status: 'BORRADOR' };

      const result = AuditService.createBeforeAfter(null, afterEntity);

      expect(result.before).toBeNull();
      expect(result.after).toEqual({ id: '1', code: 'SOL-0001', status: 'BORRADOR' });
    });

    it('should include only specified fields', () => {
      const beforeEntity = { id: '1', code: 'SOL-0001', status: 'BORRADOR', priority: 'ALTA', notes: 'test' };
      const afterEntity = { id: '1', code: 'SOL-0001', status: 'ENVIADA', priority: 'ALTA', notes: 'updated' };

      const result = AuditService.createBeforeAfter(beforeEntity, afterEntity, ['status', 'priority']);

      expect(result.before).toEqual({ status: 'BORRADOR', priority: 'ALTA' });
      expect(result.after).toEqual({ status: 'ENVIADA', priority: 'ALTA' });
    });
  });
});