import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator, HealthCheckResult, HealthIndicatorResult } from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator.js';
import { DataSource } from 'typeorm';

@ApiTags('Salud')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly dataSource: DataSource,
  ) {}

  @Get('health')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness probe - verifica que el proceso responde' })
  @ApiResponse({ status: 200, description: 'OK - El servicio está vivo' })
  async liveness(): Promise<HealthCheckResult> {
    return this.health.check([
      (): HealthIndicatorResult => ({ api: { status: 'up', details: { service: 'api', status: 'ok' } } }),
    ]);
  }

  @Get('ready')
  @Public()
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness probe - verifica conexión a BD y migraciones pendientes' })
  @ApiResponse({ status: 200, description: 'OK - El servicio está listo' })
  @ApiResponse({ status: 503, description: 'Service Unavailable - BD no disponible o migraciones pendientes' })
  async readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      // Verificar conexión a PostgreSQL con timeout de 1500ms
      () => this.db.pingCheck('database', { timeout: 1500 }),
      // Verificar que no hay migraciones pendientes
      async (): Promise<HealthIndicatorResult> => this.checkMigrations(),
    ]);
  }

  private async checkMigrations(): Promise<HealthIndicatorResult> {
    try {
      const executedMigrations = await this.dataSource.query(
        'SELECT name FROM migrations ORDER BY name',
      );
      const allMigrations = [
        '1700000000000-InitialSchema',
        '1700000000001-CreateProductsAndRequests',
        '1700000000002-InventoryAndIdempotency',
        '1700000000003-AuditLogs',
      ];

      const executedNames = executedMigrations.map((m: any) => m.name);
      const pendingMigrations = allMigrations.filter((m) => !executedNames.includes(m));

      if (pendingMigrations.length > 0) {
        return {
          migrations: {
            status: 'down',
            details: `Migraciones pendientes: ${pendingMigrations.join(', ')}`,
          },
        };
      }

      return {
        migrations: {
          status: 'up',
          details: 'Todas las migraciones aplicadas',
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        migrations: {
          status: 'down',
          details: `Error verificando migraciones: ${message}`,
        },
      };
    }
  }
}