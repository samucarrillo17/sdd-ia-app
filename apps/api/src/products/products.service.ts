import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './product.entity.js';
import { TenantScopedService } from '../common/tenant/tenant-scoped.service.js';
import { ProductResponseDto } from './dto/product-response.dto.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';
import { applySorting, paginate } from '../common/utils/pagination.js';

@Injectable()
export class ProductsService extends TenantScopedService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {
    super();
  }

  async findAll(
    organizationId: string,
    params: PaginationQueryDto & { search?: string; sortBy?: string; sortDir?: 'ASC' | 'DESC' } = {} as any,
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    const { search } = params;

    const qb = this.getTenantQueryBuilder(this.productRepository, organizationId, 'product')
      .where('product.isActive = :isActive', { isActive: true });

    if (search) {
      qb.andWhere(
        '(product.sku ILIKE :search OR product.name ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    // Whitelist sortBy
    applySorting(qb, params.sortBy, ['sku', 'name', 'createdAt'], 'sku', params.sortDir);

    // Paginación con orden determinista
    const result = await paginate(qb, params, 'sku');

    // Mapear a DTOs
    return {
      ...result,
      data: result.data.map((entity: Product) => {
        const dto = new ProductResponseDto();
        Object.assign(dto, entity);
        return dto;
      }),
    };
  }

  async findById(organizationId: string, id: string): Promise<ProductResponseDto | null> {
    const entity = await this.findOneByTenant(this.productRepository, organizationId, {
      where: { id },
    });

    if (!entity) {
      return null;
    }

    const dto = new ProductResponseDto();
    Object.assign(dto, entity);
    return dto;
  }
}