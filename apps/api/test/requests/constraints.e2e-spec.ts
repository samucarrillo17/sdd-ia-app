import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { Role } from '../../src/users/role.enum.js';
import cookieParser from 'cookie-parser';

describe('Database CHECK Constraints Tests (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let agentCoord: request.SuperAgentTest;
  let agentBodega: request.SuperAgentTest;
  let agentSolA: request.SuperAgentTest;

  let products: {
    productA1: string;
  } = {
    productA1: '',
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
  });

  describe('9. CHECK constraints rechazan UPDATE manual que deje on_hand < 0', () => {
    it('CHK_inventory_on_hand_nonneg: UPDATE directo a inventory con on_hand negativo falla', async () => {
      await expect(
        dataSource.query(`UPDATE inventory SET "on_hand" = -1 WHERE "product_id" = $1`, [products.productA1])
      ).rejects.toThrow();
    });

    it('CHK_inventory_reserved_nonneg: UPDATE directo a inventory con reserved negativo falla', async () => {
      await expect(
        dataSource.query(`UPDATE inventory SET "reserved" = -1 WHERE "product_id" = $1`, [products.productA1])
      ).rejects.toThrow();
    });

    it('CHK_inventory_reserved_le_on_hand: UPDATE directo con reserved > on_hand falla', async () => {
      await expect(
        dataSource.query(`UPDATE inventory SET "reserved" = 15 WHERE "product_id" = $1`, [products.productA1])
      ).rejects.toThrow();
    });

    it('CHK_inventory_movements_quantity_positive: INSERT movement con quantity <= 0 falla', async () => {
      await expect(
        dataSource.query(
          `INSERT INTO inventory_movements ("id", "organization_id", "product_id", "type", "quantity", "created_by", "created_at") 
           VALUES (gen_random_uuid(), (SELECT id FROM organizations WHERE code = 'ORG-A'), $1, 'AJUSTE', 0, (SELECT id FROM users WHERE email = 'coordinador@org-a.test'), now())`,
          [products.productA1]
        )
      ).rejects.toThrow();
    });

    it('CHK_request_items_quantity_positive: INSERT request_item con quantity <= 0 falla', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createRes = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 5 }],
        })
        .expect(201);

      const requestId = createRes.body.request.id;

      await expect(
        dataSource.query(
          `INSERT INTO request_items ("id", "request_id", "product_id", "quantity") 
           VALUES (gen_random_uuid(), $1, $2, 0)`,
          [requestId, products.productA1]
        )
      ).rejects.toThrow();
    });
  });

  describe('CHECK constraints protegen contra bugs de aplicación', () => {
    it('reserve no puede dejar reserved > on_hand aunque haya bug', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createRes = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 5 }],
        })
        .expect(201);

      const requestId = createRes.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', '99999999-9999-9999-9999-999999999999')
        .send({})
        .expect(200);

      const inventoryAfter = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryAfter[0].reserved).toBeLessThanOrEqual(inventoryAfter[0].on_hand);
      expect(inventoryAfter[0].reserved).toBe(5);
    });

    it('dispatch no puede dejar on_hand < 0 aunque haya bug', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createRes = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 3 }],
        })
        .expect(201);

      const requestId = createRes.body.request.id;

      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      await agentCoord
        .post(`/api/requests/${requestId}/reserve`)
        .set('Idempotency-Key', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
        .send({})
        .expect(200);

      await agentBodega
        .post(`/api/requests/${requestId}/dispatch`)
        .send({})
        .expect(200);

      const inventoryAfter = await dataSource.query(
        `SELECT "on_hand", "reserved" FROM inventory WHERE "product_id" = $1`,
        [products.productA1]
      );
      expect(inventoryAfter[0].on_hand).toBeGreaterThanOrEqual(0);
      expect(inventoryAfter[0].on_hand).toBe(7);
      expect(inventoryAfter[0].reserved).toBe(0);
    });
  });
});