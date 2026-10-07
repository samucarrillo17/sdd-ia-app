import { Injectable } from '@nestjs/common';
import { Repository, FindOptionsWhere, FindManyOptions, DeepPartial, ObjectLiteral } from 'typeorm';
import { AuthenticatedUser } from '../guards/session-auth.guard.js';

@Injectable()
export class TenantScopedService {
  protected applyTenantScope<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
  ): Repository<T> {
    return repository.manager.getRepository(repository.target);
  }

  protected getTenantQueryBuilder<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
    alias: string = 'entity',
  ) {
    return repository.createQueryBuilder(alias).where(`${alias}.organizationId = :organizationId`, {
      organizationId,
    });
  }

  async findByTenant<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
    options?: FindManyOptions<T>,
  ): Promise<T[]> {
    return repository.find({
      ...options,
      where: {
        ...options?.where,
        organizationId,
      } as FindOptionsWhere<T>,
    });
  }

  async findOneByTenant<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
    options?: FindManyOptions<T>,
  ): Promise<T | null> {
    return repository.findOne({
      ...options,
      where: {
        ...options?.where,
        organizationId,
      } as FindOptionsWhere<T>,
    });
  }

  async createWithTenant<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
    data: DeepPartial<T>,
  ): Promise<T> {
    const entity = repository.create({
      ...data,
      organizationId,
    } as DeepPartial<T>);
    return repository.save(entity);
  }

  async updateByTenant<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
    id: string,
    data: DeepPartial<T>,
  ): Promise<T | null> {
    const entity = await this.findOneByTenant(repository, organizationId, { where: { id } as any });
    if (!entity) {
      return null;
    }
    Object.assign(entity, data);
    return repository.save(entity);
  }

  async deleteByTenant<T extends ObjectLiteral>(
    repository: Repository<T>,
    organizationId: string,
    id: string,
  ): Promise<boolean> {
    const result = await repository.delete({ id, organizationId } as any);
    return (result.affected ?? 0) > 0;
  }

  getOrganizationId(user: AuthenticatedUser): string {
    return user.organizationId;
  }
}