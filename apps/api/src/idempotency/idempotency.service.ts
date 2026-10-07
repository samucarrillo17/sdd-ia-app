import { Injectable, ConflictException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, EntityManager } from 'typeorm';
import { IdempotencyKey } from '../idempotency/idempotency-key.entity.js';
import { createHash } from 'crypto';

export interface IdempotencyResult<T> {
  status: number;
  body: T;
}

export interface RunIdempotentOptions<T> {
  key: string;
  endpoint: string;
  organizationId: string;
  requestHash: string;
  fn: (manager: EntityManager) => Promise<IdempotencyResult<T>>;
}

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyRepository: Repository<IdempotencyKey>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ejecuta una operación de forma idempotente.
   * 
   * Flujo:
   * 1. Nueva clave → Inserta IN_PROGRESS, ejecuta fn, guarda resultado COMPLETED
   * 2. Misma clave + mismo hash + COMPLETED → Devuelve respuesta guardada
   * 3. Misma clave + mismo hash + IN_PROGRESS → 409 REQUEST_IN_PROGRESS
   * 4. Misma clave + hash distinto → 422 IDEMPOTENCY_KEY_REUSED
   * 
   * Si fn lanza error de negocio, la transacción hace rollback y la fila IN_PROGRESS
   * se elimina (permite reintentar con la misma clave).
   */
  async runIdempotent<T>(options: RunIdempotentOptions<T>): Promise<IdempotencyResult<T>> {
    const { key, endpoint, organizationId, requestHash, fn } = options;

    return this.dataSource.transaction(async (manager) => {
      // Intentar insertar nueva clave (IN_PROGRESS)
      const existingKey = await manager.findOne(IdempotencyKey, {
        where: { organizationId, endpoint, key },
        lock: { mode: 'pessimistic_write' },
      });

      if (existingKey) {
        // Clave existente
        if (existingKey.requestHash !== requestHash) {
          // Misma clave, hash distinto → 422
          throw new UnprocessableEntityException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'La clave de idempotencia ya fue usada con un request distinto',
          });
        }

        if (existingKey.status === 'IN_PROGRESS') {
          // Misma clave, mismo hash, en progreso → 409
          throw new ConflictException({
            code: 'REQUEST_IN_PROGRESS',
            message: 'Ya hay una request en progreso con esta clave',
          });
        }

        // Misma clave, mismo hash, COMPLETED → devolver respuesta guardada
        return {
          status: existingKey.responseStatus ?? 200,
          body: existingKey.responseBody as T,
        };
      }

      // Nueva clave: insertar IN_PROGRESS
      const newKey = manager.create(IdempotencyKey, {
        organizationId,
        key,
        endpoint,
        requestHash,
        status: 'IN_PROGRESS',
      });
      await manager.save(newKey);

      try {
        // Ejecutar la función de negocio
        const result = await fn(manager);

        // Guardar resultado como COMPLETED
        newKey.status = 'COMPLETED';
        newKey.responseStatus = result.status;
        newKey.responseBody = result.body as Record<string, unknown>;
        await manager.save(newKey);

        return result;
      } catch (error) {
        // Si falla, eliminar la fila IN_PROGRESS para permitir reintento
        await manager.delete(IdempotencyKey, { id: newKey.id });
        throw error;
      }
    });
  }

  /**
   * Genera hash SHA-256 del request (method + path + body)
   */
  static generateRequestHash(method: string, path: string, body: unknown): string {
    const content = `${method}:${path}:${JSON.stringify(body)}`;
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Limpia claves expiradas (>24h). Para job programado.
   */
  async cleanupExpiredKeys(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
    const result = await this.idempotencyRepository
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}