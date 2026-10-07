import { IsOptional, IsEnum, IsUUID, IsString, IsDateString, IsIn, IsInt, Min, Max, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto.js';
import { RequestStatus } from '../enums/request-status.enum.js';
import { Priority } from '../enums/priority.enum.js';

export class ListRequestsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por estados', enum: RequestStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(RequestStatus, { each: true })
  status?: RequestStatus[];

  @ApiPropertyOptional({ description: 'Filtrar por prioridades', enum: Priority, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(Priority, { each: true })
  priority?: Priority[];

  @ApiPropertyOptional({ description: 'Filtrar por solicitante (UUID)' })
  @IsOptional()
  @IsUUID()
  requesterId?: string;

  @ApiPropertyOptional({ description: 'Fecha neededBy desde (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  neededFrom?: string;

  @ApiPropertyOptional({ description: 'Fecha neededBy hasta (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  neededTo?: string;

  @ApiPropertyOptional({ description: 'Fecha creación desde (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: 'Fecha creación hasta (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;

  @ApiPropertyOptional({ description: 'Búsqueda por código de solicitud' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Campo de ordenamiento', enum: ['createdAt', 'neededBy', 'priority'], default: 'createdAt' })
  @IsOptional()
  @IsString()
  @IsIn(['createdAt', 'neededBy', 'priority'])
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ description: 'Dirección de ordenamiento', enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortDir?: 'ASC' | 'DESC' = 'DESC';
}