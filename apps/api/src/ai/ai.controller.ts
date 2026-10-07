import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Roles } from '../common/decorators/roles.decorator.js';
import { Role } from '../users/role.enum.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { CreateSummaryDto } from './dto/create-summary.dto.js';
import { AiService, SummaryResponse, FallbackReason } from './ai.service.js';

@ApiTags('ai')
@Controller('ai')
@UseGuards(ThrottlerGuard, RolesGuard)
@ApiBearerAuth()
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Post('summaries')
  @Roles(Role.COORDINADOR)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Genera resumen con recomendaciones para solicitudes ENVIADA (solo COORDINADOR)' })
  @ApiResponse({ status: 200, description: 'Resumen generado (source: ai | fallback)' })
  @ApiResponse({ status: 400, description: 'Más de 20 requestIds o solicitudes inválidas' })
  @ApiResponse({ status: 403, description: 'Solo rol COORDINADOR' })
  @ApiResponse({ status: 404, description: 'Solicitudes no encontradas o no pertenecen a la organización' })
  async summarize(
    @Request() req: { user: { id: string; organizationId: string; role: string } },
    @Body() dto: CreateSummaryDto,
  ): Promise<SummaryResponse> {
    return this.aiService.summarize(req.user, dto);
  }
}