import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Role } from '../../src/users/role.enum.js';
import { RequestStatus } from '../../src/requests/enums/request-status.enum.js';
import cookieParser from 'cookie-parser';

// Helper to extract cookie value from Set-Cookie header
function extractCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('Requests (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  let agentSolA: request.SuperAgentTest;
  let agentCoordA: request.SuperAgentTest;
  let agentBodegaA: request.SuperAgentTest;
  let agentAuditorA: request.SuperAgentTest;
  let agentSolB: request.SuperAgentTest;

  let products: {
    productA1: string;
    productA2: string;
    productB1: string;
  } = {
    productA1: '',
    productA2: '',
    productB1: '',
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

    // Create agents
    agentSolA = request.agent(app.getHttpServer());
    agentCoordA = request.agent(app.getHttpServer());
    agentBodegaA = request.agent(app.getHttpServer());
    agentAuditorA = request.agent(app.getHttpServer());
    agentSolB = request.agent(app.getHttpServer());

    // Login all agents
    await agentSolA
      .post('/api/auth/login')
      .send({ email: 'solicitante@org-a.test', password: 'devpassword123' })
      .expect(200);

    await agentCoordA
      .post('/api/auth/login')
      .send({ email: 'coordinador@org-a.test', password: 'devpassword123' })
      .expect(200);

    await agentBodegaA
      .post('/api/auth/login')
      .send({ email: 'bodega@org-a.test', password: 'devpassword123' })
      .expect(200);

    await agentAuditorA
      .post('/api/auth/login')
      .send({ email: 'auditor@org-a.test', password: 'devpassword123' })
      .expect(200);

    await agentSolB
      .post('/api/auth/login')
      .send({ email: 'solicitante@org-b.test', password: 'devpassword123' })
      .expect(200);

    // Get product IDs
    const productRepo = dataSource.getRepository('products');
    const productsData = await productRepo.find({ 
      relations: { organization: true },
      where: { isActive: true }
    });
    const productMap = new Map(productsData.map((p) => [p.sku, p.id]));
    
    products.productA1 = productMap.get('SKU-A-001')!;
    products.productA2 = productMap.get('SKU-A-002')!;
    products.productB1 = productMap.get('SKU-B-001')!;
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

  describe('POST /api/requests - Create Request', () => {
    it('should create a request with valid data (201)', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const response = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          notes: 'Test request',
          items: [
            { productId: products.productA1, quantity: 5 },
          ],
        })
        .expect(201);

      expect(response.body.request).toBeDefined();
      expect(response.body.request.code).toMatch(/^SOL-\d{6}$/);
      expect(response.body.request.status).toBe('BORRADOR');
      expect(response.body.request.items).toHaveLength(1);
      expect(response.body.request.items[0].quantity).toBe(5);
    });

    it('should return 400 when creating with 0 items', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [],
        })
        .expect(400);
    });

    it('should return 400 when creating with 11 items', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: Array(11).fill({ productId: products.productA1, quantity: 1 }),
        })
        .expect(400);
    });

    it('should return 400 when creating with duplicate SKUs', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [
            { productId: products.productA1, quantity: 1 },
            { productId: products.productA1, quantity: 2 },
          ],
        })
        .expect(400);
    });

    it('should return 400 when quantity is 0', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 0 }],
        })
        .expect(400);
    });

    it('should return 404 when product belongs to another organization', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productB1, quantity: 1 }],
        })
        .expect(404);
    });

    it('should return 400 when neededBy is in the past', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const neededBy = yesterday.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 1 }],
        })
        .expect(400);
    });
  });

  describe('GET /api/requests/:id - Get Request', () => {
    let requestId: string;

    beforeEach(async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 5 }],
        })
        .expect(201);

      requestId = createResponse.body.request.id;
    });

    it('should allow owner to view their request', async () => {
      await agentSolA
        .get(`/api/requests/${requestId}`)
        .expect(200);
    });

    it('should allow COORDINADOR to view any request in org', async () => {
      await agentCoordA
        .get(`/api/requests/${requestId}`)
        .expect(200);
    });

    it('should allow BODEGA to view any request in org', async () => {
      await agentBodegaA
        .get(`/api/requests/${requestId}`)
        .expect(200);
    });

    it('should allow AUDITOR to view any request in org', async () => {
      await agentAuditorA
        .get(`/api/requests/${requestId}`)
        .expect(200);
    });

    it('should return 404 when SOLICITANTE from another org tries to view', async () => {
      await agentSolB
        .get(`/api/requests/${requestId}`)
        .expect(404);
    });

    it('should return 404 for non-existent request', async () => {
      await agentSolA
        .get('/api/requests/00000000-0000-0000-0000-000000000000')
        .expect(404);
    });
  });

  describe('PUT /api/requests/:id - Update Request', () => {
    let requestId: string;

    beforeEach(async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 5 }],
        })
        .expect(201);

      requestId = createResponse.body.request.id;
    });

    it('should allow owner to update their BORRADOR request', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .put(`/api/requests/${requestId}`)
        .send({
          priority: 'ALTA',
          neededBy,
          items: [{ productId: products.productA2, quantity: 10 }],
        })
        .expect(200);
    });

    it('should return 404 when another user tries to update', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolB
        .put(`/api/requests/${requestId}`)
        .send({
          priority: 'ALTA',
          neededBy,
          items: [{ productId: products.productB1, quantity: 10 }],
        })
        .expect(404); // Returns 404 not 403 to not leak existence
    });

    it('should return 409 when trying to update ENVIADA request', async () => {
      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 2);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .put(`/api/requests/${requestId}`)
        .send({
          priority: 'ALTA',
          neededBy,
          items: [{ productId: products.productA2, quantity: 10 }],
        })
        .expect(409);
    });
  });

  describe('DELETE /api/requests/:id - Delete Request', () => {
    let requestId: string;

    beforeEach(async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 5 }],
        })
        .expect(201);

      requestId = createResponse.body.request.id;
    });

    it('should allow owner to delete their BORRADOR request', async () => {
      await agentSolA
        .delete(`/api/requests/${requestId}`)
        .expect(204);
    });

    it('should return 404 when another user tries to delete', async () => {
      await agentSolB
        .delete(`/api/requests/${requestId}`)
        .expect(404);
    });

    it('should return 409 when trying to delete ENVIADA request', async () => {
      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      await agentSolA
        .delete(`/api/requests/${requestId}`)
        .expect(409);
    });
  });

  describe('POST /api/requests/:id/submit - Submit Request', () => {
    let requestId: string;

    beforeEach(async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 5 }],
        })
        .expect(201);

      requestId = createResponse.body.request.id;
    });

    it('should submit request (BORRADOR -> ENVIADA)', async () => {
      const response = await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      expect(response.body.status).toBe('ENVIADA');
      expect(response.body.submittedAt).toBeDefined();
    });

    it('should return 409 when submitting twice (double submit)', async () => {
      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(409);
    });

    it('should return 404 when another user tries to submit', async () => {
      await agentSolB
        .post(`/api/requests/${requestId}/submit`)
        .expect(404); // Returns 404 not 403 to not leak existence
    });

    it('should return 409 when submitting already ENVIADA request', async () => {
      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(200);

      await agentSolA
        .post(`/api/requests/${requestId}/submit`)
        .expect(409);
    });
  });

  describe('Multi-tenant isolation', () => {
    it('should not allow ORG-A user to create request with ORG-B products', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      await agentSolA
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productB1, quantity: 1 }],
        })
        .expect(404);
    });

    it('should not allow ORG-A user to view ORG-B requests', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const neededBy = tomorrow.toISOString().split('T')[0];

      const createResponse = await agentSolB
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productB1, quantity: 1 }],
        })
        .expect(201);

      const requestIdB = createResponse.body.request.id;

      await agentSolA
        .get(`/api/requests/${requestIdB}`)
        .expect(404);
    });
  });
});