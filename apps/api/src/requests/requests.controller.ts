import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Headers,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse, ApiBody, ApiHeader, ApiQuery } from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../common/guards/session-auth.guard.js';
import { Role } from '../users/role.enum.js';
import { RequestsService, type CreateRequestResult } from './requests.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { UpdateRequestDto } from './dto/update-request.dto.js';
import { ListRequestsQueryDto } from './dto/list-requests-query.dto.js';
import { RequestResponseDto } from './dto/request-response.dto.js';
import { PaginatedResponse } from '../common/dto/pagination-query.dto.js';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor.js';

@ApiTags('Requests')
@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  @Roles(Role.SOLICITANTE, Role.COORDINADOR, Role.BODEGA, Role.AUDITOR)
  @ApiOperation({ summary: 'Lista solicitudes con filtros y paginación' })
  @ApiResponse({ status: 200, description: 'Lista paginada de solicitudes' })
  @ApiResponse({ status: 400, description: 'Parámetros inválidos (ej. limit > 100)' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListRequestsQueryDto,
  ): Promise<PaginatedResponse<RequestResponseDto>> {
    return this.requestsService.findAll(dto, user);
  }

  @Get(':id')
  @Roles(Role.SOLICITANTE, Role.COORDINADOR, Role.BODEGA, Role.AUDITOR)
  @ApiOperation({ summary: 'Obtiene el detalle de una solicitud con sus ítems' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 200, type: RequestResponseDto })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada o no pertenece a la organización/usuario' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RequestResponseDto> {
    return this.requestsService.findOne(id, user);
  }

  @Get(':id/history')
  @Roles(Role.SOLICITANTE, Role.COORDINADOR, Role.BODEGA, Role.AUDITOR)
  @ApiOperation({ summary: 'Historial de auditoría de una solicitud' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de logs de auditoría' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada o sin permisos' })
  async findHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() dto: ListRequestsQueryDto,
  ): Promise<PaginatedResponse<any>> {
    return this.requestsService.findHistory(id, dto, user);
  }

  @Post()
  @Roles(Role.SOLICITANTE)
  @ApiOperation({ summary: 'Crea un borrador de solicitud' })
  @ApiBody({ type: CreateRequestDto })
  @ApiResponse({ status: 201, type: RequestResponseDto })
  @ApiResponse({ status: 400, description: 'Validación fallida' })
  @ApiResponse({ status: 404, description: 'Producto no encontrado' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateRequestDto,
  ): Promise<CreateRequestResult> {
    return this.requestsService.create(user.id, dto);
  }

  @Put(':id')
  @Roles(Role.SOLICITANTE)
  @ApiOperation({ summary: 'Edita un borrador de solicitud (reemplaza ítems completos)' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiBody({ type: UpdateRequestDto })
  @ApiResponse({ status: 200, type: RequestResponseDto })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'La solicitud no está en estado BORRADOR' })
  @ApiResponse({ status: 403, description: 'No es dueño de la solicitud' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRequestDto,
  ): Promise<RequestResponseDto> {
    return this.requestsService.update(id, user.id, dto);
  }

  @Delete(':id')
  @Roles(Role.SOLICITANTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Elimina un borrador de solicitud' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 204, description: 'Eliminado correctamente' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'La solicitud no está en estado BORRADOR' })
  @ApiResponse({ status: 403, description: 'No es dueño de la solicitud' })
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.requestsService.delete(id, user.id);
  }

  @Post(':id/submit')
  @Roles(Role.SOLICITANTE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Envía una solicitud (BORRADOR -> ENVIADA)' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 200, type: RequestResponseDto })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'La solicitud no está en estado BORRADOR o validación fallida' })
  @ApiResponse({ status: 403, description: 'No es dueño de la solicitud' })
  async submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RequestResponseDto> {
    return this.requestsService.submit(id, user.id);
  }

  @Post(':id/reserve')
  @Roles(Role.COORDINADOR)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Reserva stock para una solicitud (ENVIADA -> RESERVADA)' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiHeader({ name: 'Idempotency-Key', description: 'Clave de idempotencia (UUID)', required: true })
  @ApiResponse({ status: 200, type: RequestResponseDto, description: 'Stock reservado, estado RESERVADA' })
  @ApiResponse({ status: 400, description: 'Idempotency-Key requerida o formato inválido' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION o INSUFFICIENT_STOCK o REQUEST_IN_PROGRESS' })
  @ApiResponse({ status: 422, description: 'IDEMPOTENCY_KEY_REUSED (misma clave, request distinto)' })
  async reserve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() body: unknown,
  ): Promise<RequestResponseDto> {
    return this.requestsService.reserve(id, user, idempotencyKey, body);
  }

  @Post(':id/dispatch')
  @Roles(Role.BODEGA)
  @ApiOperation({ summary: 'Despacha una solicitud (RESERVADA -> DESPACHADA)' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 200, type: RequestResponseDto, description: 'Stock despachado, estado DESPACHADA' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION o INSUFFICIENT_RESERVED' })
  @ApiResponse({ status: 403, description: 'Rol BODEGA requerido' })
  async dispatch(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RequestResponseDto> {
    return this.requestsService.dispatch(id, user);
  }

  @Post(':id/deliver')
  @Roles(Role.COORDINADOR, Role.BODEGA)
  @ApiOperation({ summary: 'Marca una solicitud como entregada (DESPACHADA -> ENTREGADA)' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 200, type: RequestResponseDto, description: 'Estado ENTREGADA' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  @ApiResponse({ status: 403, description: 'Rol COORDINADOR o BODEGA requerido' })
  async deliver(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RequestResponseDto> {
    return this.requestsService.deliver(id, user);
  }

  @Post(':id/cancel')
  @Roles(Role.SOLICITANTE, Role.COORDINADOR)
  @ApiOperation({ summary: 'Cancela una solicitud (según tabla de transiciones)' })
  @ApiParam({ name: 'id', description: 'ID de la solicitud (UUID)' })
  @ApiResponse({ status: 200, type: RequestResponseDto, description: 'Estado CANCELADA (libera stock si era RESERVADA)' })
  @ApiResponse({ status: 404, description: 'Solicitud no encontrada' })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION (no se puede cancelar desde DESPACHADA/ENTREGADA/CANCELADA)' })
  @ApiResponse({ status: 403, description: 'SOLICITANTE solo puede cancelar sus propias solicitudes en BORRADOR/ENVIADA' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<RequestResponseDto> {
    return this.requestsService.cancel(id, user);
  }
}