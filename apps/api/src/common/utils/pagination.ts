import { SelectQueryBuilder } from 'typeorm';
import { ObjectLiteral } from 'typeorm/common/ObjectLiteral.js';
import { PaginationQueryDto, PaginatedResponse } from '../dto/pagination-query.dto.js';

/**
 * Helper de paginación reutilizable.
 * Usa skip/take y getManyAndCount() para obtener datos y total en una sola consulta.
 * Garantiza orden determinista: siempre desempata por `id` ASC.
 *
 * @param queryBuilder - QueryBuilder ya configurado con WHERE, JOINs, etc.
 * @param dto - DTO de paginación validado (page, limit)
 * @param defaultSortBy - Campo por defecto para ordenar (ej: 'createdAt')
 * @returns Objeto con { data, meta: { page, limit, total, totalPages } }
 */
export async function paginate<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  dto: PaginationQueryDto,
  defaultSortBy: string = 'createdAt',
): Promise<PaginatedResponse<T>> {
  const { page, limit } = dto;

  // Aplicar ordenamiento determinista: campo solicitado + id ASC como tie-breaker
  // Nota: el campo de ordenamiento principal debe validarse en el DTO del endpoint (whitelist)
  const sortBy = (queryBuilder as any)._sortBy ?? defaultSortBy;
  const sortDir = (queryBuilder as any)._sortDir ?? 'DESC';

  queryBuilder.orderBy(`${queryBuilder.alias}.${sortBy}`, sortDir as 'ASC' | 'DESC');
  queryBuilder.addOrderBy(`${queryBuilder.alias}.id`, 'ASC');

  // Paginación: skip = (page - 1) * limit, take = limit
  const skip = (page - 1) * limit;
  queryBuilder.skip(skip).take(limit);

  // Ejecutar consulta con conteo total
  const [data, total] = await queryBuilder.getManyAndCount();

  const totalPages = Math.ceil(total / limit);

  return {
    data,
    meta: {
      page,
      limit,
      total,
      totalPages,
    },
  };
}

/**
 * Helper para aplicar ordenamiento con whitelist al queryBuilder.
 * Debe llamarse ANTES de paginate().
 *
 * @param queryBuilder - QueryBuilder
 * @param sortBy - Campo solicitado por el cliente
 * @param allowedFields - Array de campos permitidos (whitelist)
 * @param defaultField - Campo por defecto si sortBy no se provee o es inválido
 * @param sortDir - Dirección ('ASC' | 'DESC'), default 'DESC'
 * @returns El campo de ordenamiento validado que se usará
 */
export function applySorting<T extends ObjectLiteral>(
  queryBuilder: SelectQueryBuilder<T>,
  sortBy: string | undefined,
  allowedFields: string[],
  defaultField: string,
  sortDir: 'ASC' | 'DESC' = 'DESC',
): string {
  const validatedSortBy = sortBy && allowedFields.includes(sortBy) ? sortBy : defaultField;
  const validatedSortDir = sortDir === 'ASC' ? 'ASC' : 'DESC';

  // Guardar en el queryBuilder para que paginate() los use
  (queryBuilder as any)._sortBy = validatedSortBy;
  (queryBuilder as any)._sortDir = validatedSortDir;

  return validatedSortBy;
}