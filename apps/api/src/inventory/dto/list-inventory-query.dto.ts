import { IsOptional, IsString, IsBoolean, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';

export class ListInventoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Búsqueda por SKU o nombre' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Solo productos con stock bajo (disponible ≤ umbral)', type: Boolean })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  lowStock?: boolean;

  @ApiPropertyOptional({ description: 'Campo de ordenamiento', enum: ['sku', 'name', 'onHand', 'reserved', 'available', 'createdAt'], default: 'sku' })
  @IsOptional()
  @IsString()
  @IsIn(['sku', 'name', 'onHand', 'reserved', 'available', 'createdAt'])
  sortBy?: string = 'sku';

  @ApiPropertyOptional({ description: 'Dirección de ordenamiento', enum: ['ASC', 'DESC'], default: 'ASC' })
  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortDir?: 'ASC' | 'DESC' = 'ASC';
}