import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Role } from '../../src/users/role.enum.js';
import cookieParser from 'cookie-parser';

describe('Idempotency Tests (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let agentCoord: request.SuperAgentTest;
  let agentSolA: request.SuperAgentTest;

  let products: {
    productA1: string;
    productA2: string;
  } = {
    productA1: '',
    productA2: '',
  };

  let requestId: string = '';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get<DataSource>(getDataSourceToken());

    agentCoord = request.agent(app.getHttpServer());
    agentSolA = request.agent(app.getHttpServer());

    await agentCoord
      .post('/api/auth/login')
      .send({ email: 'coordinador@org-a.test', password: 'devpassword123' })
      .expect(200);

    await agentSolA
      .post('/api/auth/login')
      .send({ email: 'solicitante@org-a.test', password: 'devpassword123' })
      .expect(200);

    const productRepo = dataSource.getRepository('products');
    const productsData = await productRepo.find({ where: { organization: { code: 'ORG-A' } } });
    const productMap = new Map(productsData.map((p) => [p.sku, p.id]));
    
    products.productA1 = productMap.get('SKU-A-001')!;
    products.productA2 = productMap.get('SKU-A-002')!;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM idempotency_keys');
    await dataSource.query('DELETE FROM inventory_movements');
    await dataSource.query('DELETE FROM inventory');
    await dataSource.query('DELETE FROM request_items');
    await dataSource.query('DELETE FROM requests');

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const neededBy = tomorrow.toISOString().split('T')[0];

    const createResponse = await agentSolA
      .post('/api/requests')
      .send({
        priority: 'MEDIA',
        neededBy,
        items: [
          { productId: products.productA1, quantity: 2 },
          { productId: products.productA2, quantity: 1 },
        ],
      })
      .expect(201);

    requestId = createResponse.body.request.id;

    await agentSolA
      .post(`/api/requests/${requestId}/submit`)
      .expect(200);
  });

  describe('4. Idempotencia - repetir reserve con misma clave 3 veces', () => {
    it('una sola reserva y respuestas idénticas', async () => {
      const idempotencyKey = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

      const res1 = await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(200);

      expect(res1.body.status).toBe('RESERVADA');

      const res2 = await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(200);

      const res3 = await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(200);

      expect(res2.body).toEqual(res1.body);
      expect(res3.body).toEqual(res1.body);

      const inventoryA1 = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      const inventoryA2 = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA2]
      );

      expect(inventoryA1[0].reserved).toBe(2);
      expect(inventoryA2[0].reserved).toBe(1);

      const movements = await dataSource.query(
        `SELECT COUNT(*) FROM inventory_movements WHERE "request_id" = $1 AND "type" = 'RESERVA'`,
        [requestId]
      );
      expect(parseInt(movements[0].count)).toBe(2);
    });
  });

  describe('5. Misma clave con otra solicitud → 422', () => {
    it('usar la misma Idempotency-Key para otra solicitud falla con 422 IDEMPOTENCY_KEY_REUSED', async () => {
      const idempotencyKey = '11111111-1111-1111-1111-111111111111';

      await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(200);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 1 }],
        })
        .expect(201);

      const requestId2 = createResponse.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestId2}/submit`)
        .expect(200);

      const res = await agentCoord
        .post(`/api/requests/${requestId2}/reserve`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(422);

      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('6. Sin cabecera Idempotency-Key → 400', () => {
    it('petición sin Idempotency-Key falla con 400 IDEMPOTENCY_KEY_REQUIRED', async () => {
      const res = await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .send({})
        .expect(400);

      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    });
  });

  describe('7. Formato UUID inválido → 400', () => {
    it('Idempotency-Key con formato inválido falla con 400', async () => {
      const res = await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', 'not-a-valid-uuid')
        .send({})
        .expect(400);

      expect(res.body.code).toBe('IDEMPOTENCY_KEY_INVALID_FORMAT');
    });
  });

  describe('8. REQUEST_IN_PROGRESS - misma clave, mismo hash, en progreso', () => {
    it('la idempotency key se guarda como COMPLETED tras éxito', async () => {
      const idempotencyKey = '22222222-2222-2222-2222-222222222222';

      await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', idempotencyKey)
        .send({})
        .expect(200);

      const keyRecord = await dataSource.query(
        `SELECT "status", "response_status" FROM idempotency_keys WHERE "key" = $1`,
        [idempotencyKey]
      );
      expect(keyRecord[0].status).toBe('COMPLETED');
      expect(keyRecord[0].response_status).toBe(200);
    });
  });
});