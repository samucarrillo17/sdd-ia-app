import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/guards/session-auth.guard.js';
import { Role } from '../users/role.enum.js';
import { InventoryService } from './inventory.service.js';
import { ListInventoryQueryDto } from './dto/list-inventory-query.dto.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';
import { InventoryListItemDto } from './inventory.service.js';

@ApiTags('Inventario')
@ApiBearerAuth()
@Controller('inventory')
@Roles(Role.SOLICITANTE, Role.COORDINADOR, Role.BODEGA, Role.AUDITOR)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'Lista inventario con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de inventario' })
  @ApiResponse({ status: 400, description: 'Parámetros inválidos (ej. limit > 100)' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListInventoryQueryDto,
  ): Promise<PaginatedResponse<InventoryListItemDto>> {
    return this.inventoryService.findAllPaginated(user.organizationId, dto);
  }
}