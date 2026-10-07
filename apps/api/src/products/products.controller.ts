import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/guards/session-auth.guard.js';
import { ProductsService } from './products.service.js';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';
import { ProductResponseDto } from './dto/product-response.dto.js';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Catálogo de productos activos (paginado, máx 100)' })
  @ApiQuery({ name: 'search', required: false, description: 'Búsqueda por SKU o nombre' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Página (default 1)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items por página (default 20, máx 100)' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['sku', 'name', 'createdAt'], description: 'Campo de ordenamiento' })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['ASC', 'DESC'], description: 'Dirección de ordenamiento' })
  @ApiOkResponse({ description: 'Lista paginada de productos' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() params: PaginationQueryDto & { search?: string; sortBy?: string; sortDir?: 'ASC' | 'DESC' },
  ): Promise<PaginatedResponse<ProductResponseDto>> {
    return this.productsService.findAll(user.organizationId, params);
  }
}