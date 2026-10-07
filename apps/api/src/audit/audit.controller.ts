import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { AuditService } from './audit.service.js';
import { AuditLogsQueryDto } from './dto/audit-logs-query.dto.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/guards/session-auth.guard.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';
import { AuditLog } from './audit-log.entity.js';
import { applySorting, paginate } from '../common/utils/pagination.js';

@ApiTags('Auditoría')
@ApiBearerAuth()
@Controller('audit-logs')
@Roles(Role.COORDINADOR, Role.AUDITOR)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOperation({ summary: 'Listar logs de auditoría con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de logs de auditoría' })
  @ApiResponse({ status: 403, description: 'Solo COORDINADOR y AUDITOR pueden acceder' })
  async findAll(
    @Query() dto: AuditLogsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PaginatedResponse<AuditLog>> {
    const qb = this.auditService['auditLogRepository'].createQueryBuilder('audit');

    // Filtro multi-tenant: SIEMPRE por organizationId de la sesión
    qb.where('audit.organizationId = :organizationId', { organizationId: user.organizationId });

    // Filtros adicionales
    if (dto.entityType) {
      qb.andWhere('audit.entityType = :entityType', { entityType: dto.entityType });
    }

    if (dto.entityId) {
      qb.andWhere('audit.entityId = :entityId', { entityId: dto.entityId });
    }

    if (dto.actorId) {
      qb.andWhere('audit.actorUserId = :actorId', { actorId: dto.actorId });
    }

    if (dto.action) {
      qb.andWhere('audit.action = :action', { action: dto.action });
    }

    if (dto.from) {
      qb.andWhere('audit.createdAt >= :from', { from: new Date(dto.from) });
    }

    if (dto.to) {
      qb.andWhere('audit.createdAt <= :to', { to: new Date(dto.to) });
    }

    // Whitelist estricta de sortBy (nunca concatenar texto del cliente en SQL)
    applySorting(qb, dto.sortBy, ['createdAt', 'entityType', 'action'], 'createdAt', dto.sortDir);

    // Paginación con orden determinista (tie-breaker por id)
    return paginate(qb, dto, 'createdAt');
  }
}