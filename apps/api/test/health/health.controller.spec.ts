import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../../src/health/health.controller.js';
import { HealthCheckService, TypeOrmHealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DataSource } from 'typeorm';
import { vi, describe, it, expect, beforeEach } from 'vitest';

describe('HealthController', () => {
  let controller: HealthController;
  let healthCheckService: HealthCheckService;
  let typeOrmHealthIndicator: TypeOrmHealthIndicator;
  let dataSource: DataSource;

  beforeEach(async () => {
    const mockHealthCheckService = {
      check: vi.fn(),
    };

    const mockTypeOrmHealthIndicator = {
      pingCheck: vi.fn().mockReturnValue({ database: { status: 'up' } }),
    };

    const mockDataSource = {
      query: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: mockHealthCheckService,
        },
        {
          provide: TypeOrmHealthIndicator,
          useValue: mockTypeOrmHealthIndicator,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    healthCheckService = module.get<HealthCheckService>(HealthCheckService);
    typeOrmHealthIndicator = module.get<TypeOrmHealthIndicator>(TypeOrmHealthIndicator);
    dataSource = module.get<DataSource>(DataSource);
  });

  describe('liveness', () => {
    it('should return up status', async () => {
      const mockResult = { status: 'ok', info: { api: { status: 'up' } }, error: {}, details: { api: { status: 'up' } } };
      healthCheckService.check.mockResolvedValue(mockResult);

      const result = await controller.liveness();

      expect(result).toEqual(mockResult);
      expect(healthCheckService.check).toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('should check database and migrations', async () => {
      const mockResult = { status: 'ok', info: { database: { status: 'up' }, migrations: { status: 'up' } }, error: {}, details: {} };
      healthCheckService.check.mockResolvedValue(mockResult);
      dataSource.query.mockResolvedValue([
        { name: '1700000000000-InitialSchema' },
        { name: '1700000000001-CreateProductsAndRequests' },
        { name: '1700000000002-InventoryAndIdempotency' },
        { name: '1700000000003-AuditLogs' },
      ]);

      const result = await controller.readiness();

      expect(result).toEqual(mockResult);
      expect(healthCheckService.check).toHaveBeenCalled();
      // El check llama internamente a pingCheck y checkMigrations
    });

    it('should return down when migrations are pending', async () => {
      const mockResult = { status: 'error', info: { database: { status: 'up' }, migrations: { status: 'down' } }, error: { migrations: { status: 'down' } }, details: {} };
      healthCheckService.check.mockResolvedValue(mockResult);
      dataSource.query.mockResolvedValue([
        { name: '1700000000000-InitialSchema' },
      ]);

      const result = await controller.readiness();

      expect(result.status).toBe('error');
    });
  });
});