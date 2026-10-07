import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Role } from '../../src/users/role.enum.js';
import { RequestStatus } from '../../src/requests/enums/request-status.enum.js';
import cookieParser from 'cookie-parser';

describe('Lifecycle Tests (E2E) - Ciclo completo de transiciones', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let agentCoord: request.SuperAgentTest;
  let agentBodega: request.SuperAgentTest;
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
    agentBodega = request.agent(app.getHttpServer());
    agentSolA = request.agent(app.getHttpServer());

    await agentCoord
      .post('/api/auth/login')
      .send({ email: 'coordinador@org-a.test', password: 'devpassword123' })
      .expect(200);

    await agentBodega
      .post('/api/auth/login')
      .send({ email: 'bodega@org-a.test', password: 'devpassword123' })
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
          { productId: products.productA1, quantity: 3 },
          { productId: products.productA2, quantity: 2 },
        ],
      })
      .expect(201);

    requestId = createResponse.body.request.id;
  });

  describe('6. Ciclo completo: ENVIADA → RESERVADA → DESPACHADA → ENTREGADA', () => {
    it('con kardex y cantidades correctas', async () => {
      const submitRes = await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);
      expect(submitRes.body.status).toBe('ENVIADA');

      const reserveRes = await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', '33333333-3333-3333-3333-333333333333')
        .send({})
        .expect(200);
      expect(reserveRes.body.status).toBe('RESERVADA');

      const inventoryA1AfterReserve = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      const inventoryA2AfterReserve = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA2]
      );
      expect(inventoryA1AfterReserve[0].reserved).toBe(3);
      expect(inventoryA2AfterReserve[0].reserved).toBe(2);
      expect(inventoryA1AfterReserve[0].on_hand).toBe(10);
      expect(inventoryA2AfterReserve[0].on_hand).toBe(25);

      const reservaMovements = await dataSource.query(
        `SELECT "type", "quantity" FROM inventory_movements WHERE "request_id" = $1 AND "type" = 'RESERVA' ORDER BY "created_at"`,
        [requestId]
      );
      expect(reservaMovements).toHaveLength(2);
      expect(reservaMovements[0].quantity).toBe(3);
      expect(reservaMovements[1].quantity).toBe(2);

      const dispatchRes = await agentBodega
        .post(`/api/requests/${requestId}/dispatch`)
        .send({})
        .expect(200);
      expect(dispatchRes.body.status).toBe('DESPACHADA');

      const inventoryA1AfterDispatch = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      const inventoryA2AfterDispatch = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA2]
      );
      expect(inventoryA1AfterDispatch[0].on_hand).toBe(7);
      expect(inventoryA1AfterDispatch[0].reserved).toBe(0);
      expect(inventoryA2AfterDispatch[0].on_hand).toBe(23);
      expect(inventoryA2AfterDispatch[0].reserved).toBe(0);

      const despachoMovements = await dataSource.query(
        `SELECT "type", "quantity" FROM inventory_movements WHERE "request_id" = $1 AND "type" = 'DESPACHO' ORDER BY "created_at"`,
        [requestId]
      );
      expect(despachoMovements).toHaveLength(2);
      expect(despachoMovements[0].quantity).toBe(3);
      expect(despachoMovements[1].quantity).toBe(2);

      const deliverRes = await agentCoord
        .post(`/api/requests/${requestId}/deliver`)
        .send({})
        .expect(200);
      expect(deliverRes.body.status).toBe('ENTREGADA');

      const inventoryA1AfterDeliver = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryA1AfterDeliver[0].on_hand).toBe(7);
      expect(inventoryA1AfterDeliver[0].reserved).toBe(0);

      const allMovements = await dataSource.query(
        `SELECT "type" FROM inventory_movements WHERE "request_id" = $1`,
        [requestId]
      );
      const types = allMovements.map((m: any) => m.type).sort();
      expect(types).toEqual(['DESPACHO', 'DESPACHO', 'RESERVA', 'RESERVA']);
    });
  });

  describe('7. Cancelar una RESERVADA libera el stock reservado', () => {
    it('stock reserved vuelve a 0, kardex LIBERACION', async () => {
      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', '44444444-4444-4444-4444-444444444444')
        .send({})
        .expect(200);

      const inventoryA1AfterReserve = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryA1AfterReserve[0].reserved).toBe(3);

      const cancelRes = await agentCoord
        .post(`/api/requests/${requestId}/cancel`)
        .send({})
        .expect(200);
      expect(cancelRes.body.status).toBe('CANCELADA');

      const inventoryA1AfterCancel = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryA1AfterCancel[0].on_hand).toBe(10);
      expect(inventoryA1AfterCancel[0].reserved).toBe(0);

      const liberacionMovements = await dataSource.query(
        `SELECT "type", "quantity" FROM inventory_movements WHERE "request_id" = $1 AND "type" = 'LIBERACION' ORDER BY "created_at"`,
        [requestId]
      );
      expect(liberacionMovements).toHaveLength(2);
      expect(liberacionMovements[0].quantity).toBe(3);
      expect(liberacionMovements[1].quantity).toBe(2);

      const allMovements = await dataSource.query(
        `SELECT "type" FROM inventory_movements WHERE "request_id" = $1`,
        [requestId]
      );
      const types = allMovements.map((m: any) => m.type).sort();
      expect(types).toEqual(['LIBERACION', 'LIBERACION', 'RESERVA', 'RESERVA']);
    });
  });

  describe('7b. Cancelar ENVIADA (por solicitante propia) no toca stock', () => {
    it('solicitante puede cancelar su ENVIADA, stock intacto', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [
            { productId: products.productA1, quantity: 3 },
            { productId: products.productA2, quantity: 2 },
          ],
        })
        .expect(201);

      const requestId2 = createResponse.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestId2}/submit`)
        .expect(200);

      const inventoryA1BeforeCancel = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryA1BeforeCancel[0].reserved).toBe(0);

      const cancelRes = await agentSolA
        .post(`/api/requests/${requestId2}/cancel`)
        .send({})
        .expect(200);
      expect(cancelRes.body.status).toBe('CANCELADA');

      const inventoryA1AfterCancel = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryA1AfterCancel[0].on_hand).toBe(10);
      expect(inventoryA1AfterCancel[0].reserved).toBe(0);

      const movements = await dataSource.query(
        `SELECT COUNT(*) FROM inventory_movements WHERE "request_id" = $1`,
        [requestId2]
      );
      expect(parseInt(movements[0].count)).toBe(0);
    });
  });
});