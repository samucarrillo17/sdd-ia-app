import { IsOptional, IsEnum, IsUUID, IsString, IsDateString, IsInt, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { AuditAction } from '../audit-log.entity.js';

export class AuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por tipo de entidad', enum: ['REQUEST', 'INVENTORY', 'USER', 'PRODUCT', 'SESSION', 'ORGANIZATION'] })
  @IsOptional()
  @IsString()
  @IsIn(['REQUEST', 'INVENTORY', 'USER', 'PRODUCT', 'SESSION', 'ORGANIZATION'])
  entityType?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID de entidad (UUID)' })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID del actor/usuario (UUID)' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por acción', enum: AuditAction })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Fecha desde (ISO 8601)', example: '2024-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha hasta (ISO 8601)', example: '2024-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Campo de ordenamiento', enum: ['createdAt', 'entityType', 'action'], default: 'createdAt' })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'entityType', 'action'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Dirección de ordenamiento', enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortDir?: 'ASC' | 'DESC' = 'DESC';
}