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

describe('Concurrency Tests (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  // Agents con cookie jar automático
  let agentCoord: request.SuperAgentTest;
  let agentBodega: request.SuperAgentTest;
  let agentSolA: request.SuperAgentTest;
  let agentSolB: request.SuperAgentTest;

  let products: {
    productA1: string;
    productA2: string;
    productA8: string;
    productA10: string;
    productA12: string;
  } = {
    productA1: '',
    productA2: '',
    productA8: '',
    productA10: '',
    productA12: '',
  };

  let requestIds: {
    request1: string;
    request2: string;
    request3: string;
  } = {
    request1: '',
    request2: '',
    request3: '',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get<DataSource>(getDataSourceToken());

    // Get organization IDs
    const orgA = await dataSource.query(`SELECT id FROM organizations WHERE code = 'ORG-A'`);
    const orgB = await dataSource.query(`SELECT id FROM organizations WHERE code = 'ORG-B'`);
    const orgAId = orgA[0].id;
    const orgBId = orgB[0].id;

    // Create agents
    agentCoord = request.agent(app.getHttpServer());
    agentBodega = request.agent(app.getHttpServer());
    agentSolA = request.agent(app.getHttpServer());
    agentSolB = request.agent(app.getHttpServer());

    // Login once per agent
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

    await agentSolB
      .post('/api/auth/login')
      .send({ email: 'solicitante@org-b.test', password: 'devpassword123' })
      .expect(200);

    // Create test products directly in database (self-contained tests)
    const productRepo = dataSource.getRepository('products');

    // Clean up any existing test products first
    await dataSource
      .createQueryBuilder()
      .delete()
      .from('inventory_movements')
      .where('"product_id" IN (SELECT id FROM products WHERE sku LIKE \'TEST-%\')')
      .execute();
    await dataSource
      .createQueryBuilder()
      .delete()
      .from('inventory')
      .where('"product_id" IN (SELECT id FROM products WHERE sku LIKE \'TEST-%\')')
      .execute();
    await dataSource
      .createQueryBuilder()
      .delete()
      .from('request_items')
      .where('"product_id" IN (SELECT id FROM products WHERE sku LIKE \'TEST-%\')')
      .execute();
    await dataSource
      .createQueryBuilder()
      .delete()
      .from('products')
      .where('sku LIKE \'TEST-%\'')
      .execute();

    // Helper to create product with inventory
    const createProductWithInventory = async (
      sku: string,
      name: string,
      onHand: number,
    ) => {
      const product = await productRepo.save({
        organizationId: orgAId,
        sku,
        name,
        unit: 'und',
        isActive: true,
      });
      await dataSource
        .createQueryBuilder()
        .insert()
        .into('inventory')
        .values({
          organization_id: orgAId,
          product_id: product.id,
          on_hand: onHand,
          reserved: 0,
        })
        .execute();
      return product.id;
    };

    // Product A1: normal stock (10)
    products.productA1 = await createProductWithInventory('TEST-A-001', 'Test Product A1', 10);

    // Product A2: normal stock (25)
    products.productA2 = await createProductWithInventory('TEST-A-002', 'Test Product A2', 25);

    // Product A8: LOW stock (5) - for insufficient stock tests
    products.productA8 = await createProductWithInventory('TEST-A-008', 'Test Product A8', 5);

    // Product A10: LOW stock (3)
    products.productA10 = await createProductWithInventory('TEST-A-010', 'Test Product A10', 3);

    // Product A12: LOW stock (2)
    products.productA12 = await createProductWithInventory('TEST-A-012', 'Test Product A12', 2);

    console.log('Created test products:', Object.keys(products).map(k => `${k}=${products[k as keyof typeof products]}`));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data only (NOT products, NOT sessions - agents need them)
    await dataSource.query('DELETE FROM idempotency_keys');
    await dataSource.query('DELETE FROM inventory_movements');
    await dataSource.query('DELETE FROM inventory');
    await dataSource.query('DELETE FROM request_items');
    await dataSource.query('DELETE FROM requests');
  });

  describe('1. Doble reserva simultánea - misma solicitud', () => {
    it('dos coordinadores reservan la misma solicitud en paralelo → exactamente una tiene éxito, la otra 409', async () => {
      // Use a date well in the future to avoid timezone issues
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const neededBy = futureDate.toISOString().split('T')[0];

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
      
      const requestId = createResponse.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      // Two coordinators try to reserve simultaneously
      const [res1, res2] = await Promise.all([
        agentCoord
          .post(`/api/requests/${requestId}/reserve`)
          .set('Idempotency-Key', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
          .send({}),
        agentCoord
          .post(`/api/requests/${requestId}/reserve`)
          .set('Idempotency-Key', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')
          .send({}),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      // Verify reserved quantity is correct
      const inventory = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventory[0].reserved).toBe(3);
    });
  });

  describe('2. Stock insuficiente concurrente - dos solicitudes, mismo SKU', () => {
    it('dos solicitudes distintas piden el último stock del mismo SKU en paralelo → una se reserva, la otra falla; nunca reserved > on_hand', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse1 = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA12, quantity: 2 }],
        })
        .expect(201);
      requestIds.request1 = createResponse1.body.request.id;

      const createResponse2 = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA12, quantity: 2 }],
        })
        .expect(201);
      requestIds.request2 = createResponse2.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestIds.request1}/submit`)
        .expect(200);

      await agentSolA
        .post(`/api/requests/${requestIds.request2}/submit`)
        .expect(200);

      const [res1, res2] = await Promise.all([
        agentCoord
          .post(`/api/requests/${requestIds.request1}/reserve`)
          .set('Idempotency-Key', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
          .send({}),
        agentCoord
          .post(`/api/requests/${requestIds.request2}/reserve`)
          .set('Idempotency-Key', 'dddddddd-dddd-dddd-dddd-dddddddddddd')
          .send({}),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 409]);

      const inventory = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA12]
      );
      expect(inventory[0].reserved).toBeLessThanOrEqual(inventory[0].on_hand);
      expect(inventory[0].reserved).toBe(2);
    });
  });

  describe('3. Todo o nada - solicitud con 3 ítems donde el 2º no tiene stock', () => {
    it('ninguno queda reservado (rollback completo)', async () => {
      // Use a date well in the future to avoid timezone issues
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const neededBy = futureDate.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [
            { productId: products.productA1, quantity: 2 },
            { productId: products.productA10, quantity: 5 }, // Only 3 available!
            { productId: products.productA2, quantity: 1 },
          ],
        })
        .expect(201);
      
      requestIds.request3 = createResponse.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestIds.request3}/submit`)
        .expect(200);

      const res = await agentCoord
        .post(`/api/requests/${requestIds.request3}/reserve`)
        .set('Idempotency-Key', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee')
        .send({})
        .expect(409);

      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect(res.body.details).toBeDefined();
      
      const insufficientItem = res.body.details.find((d: any) => d.sku === 'SKU-A-010');
      expect(insufficientItem).toBeDefined();
      expect(insufficientItem.requested).toBe(5);
      expect(insufficientItem.available).toBe(3);

      // Verify NO inventory was reserved
      const inventoryA1 = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      const inventoryA10 = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA10]
      );
      const inventoryA2 = await dataSource.query(
        `SELECT "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA2]
      );

      expect(inventoryA1[0].reserved).toBe(0);
      expect(inventoryA10[0].reserved).toBe(0);
      expect(inventoryA2[0].reserved).toBe(0);

      const movements = await dataSource.query(
        `SELECT COUNT(*) FROM inventory_movements WHERE "request_id" = $1`,
        [requestIds.request3]
      );
      expect(parseInt(movements[0].count)).toBe(0);
    });
  });
});