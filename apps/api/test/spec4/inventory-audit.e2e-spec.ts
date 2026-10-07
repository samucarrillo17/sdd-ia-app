import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';

function extractCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('SPEC-4: Inventario y Auditoría (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let cookies: Record<string, string> = {};

  const testUsers = [
    { email: 'solicitante@org-a.test', password: 'devpassword123', role: 'SOLICITANTE', orgCode: 'ORG-A' },
    { email: 'coordinador@org-a.test', password: 'devpassword123', role: 'COORDINADOR', orgCode: 'ORG-A' },
    { email: 'bodega@org-a.test', password: 'devpassword123', role: 'BODEGA', orgCode: 'ORG-A' },
    { email: 'auditor@org-a.test', password: 'devpassword123', role: 'AUDITOR', orgCode: 'ORG-A' },
    { email: 'solicitante@org-b.test', password: 'devpassword123', role: 'SOLICITANTE', orgCode: 'ORG-B' },
    { email: 'coordinador@org-b.test', password: 'devpassword123', role: 'COORDINADOR', orgCode: 'ORG-B' },
    { email: 'bodega@org-b.test', password: 'devpassword123', role: 'BODEGA', orgCode: 'ORG-B' },
    { email: 'auditor@org-b.test', password: 'devpassword123', role: 'AUDITOR', orgCode: 'ORG-B' },
  ];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();

    dataSource = moduleFixture.get<DataSource>(getDataSourceToken());
    
    // Run migrations
    await dataSource.runMigrations();

    for (const user of testUsers) {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);
      cookies[`${user.role}-${user.orgCode}`] = extractCookie(login.headers['set-cookie'][0]);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM inventory_movements');
    await dataSource.query('DELETE FROM inventory');
    await dataSource.query('DELETE FROM request_items');
    await dataSource.query('DELETE FROM requests');
    await dataSource.query('DELETE FROM products');
    await dataSource.query('DELETE FROM sessions');
  });

  // Helper: crear productos con inventario
  async function setupInventory(cookie: string) {
    const productRepo = dataSource.getRepository('products');
    const invRepo = dataSource.getRepository('inventory');
    const orgRepo = dataSource.getRepository('organizations');
    const org = await orgRepo.findOne({ where: { code: 'ORG-A' } });

    const products = [];
    for (let i = 1; i <= 15; i++) {
      const product = productRepo.create({
        sku: `SKU-${i.toString().padStart(4, '0')}`,
        name: `Producto ${i}`,
        unit: 'und',
        isActive: true,
        organizationId: org.id,
      });
      await productRepo.save(product);
      
      // Crear inventario con stock variable
      const onHand = i <= 5 ? 5 : 100; // primeros 5 con stock bajo (≤10)
      const inventory = invRepo.create({
        productId: product.id,
        organizationId: org.id,
        onHand,
        reserved: 0,
      });
      await invRepo.save(inventory);
      
      products.push({ ...product, onHand });
    }
    return products;
  }

  describe('GET /inventory', () => {
    beforeEach(async () => {
      await setupInventory(cookies['COORDINADOR-ORG-A']);
    });

    it('Lista inventario con paginación por defecto', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('Estructura de respuesta: productId, sku, name, onHand, reserved, available', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      const item = res.body.data[0];
      expect(item).toHaveProperty('productId');
      expect(item).toHaveProperty('sku');
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('onHand');
      expect(item).toHaveProperty('reserved');
      expect(item).toHaveProperty('available');
      expect(item.available).toBe(item.onHand - item.reserved);
    });

    it('Filtro search (SKU o nombre)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory?search=SKU-0001')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].sku).toContain('SKU-0001');
    });

    it('Filtro lowStock=true → solo disponibles ≤ 10', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/inventory?lowStock=true')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      for (const item of res.body.data) {
        expect(item.available).toBeLessThanOrEqual(10);
      }
    });

    it('Todos los roles pueden ver inventario', async () => {
      for (const role of ['SOLICITANTE', 'COORDINADOR', 'BODEGA', 'AUDITOR']) {
        const res = await request(app.getHttpServer())
          .get('/api/inventory')
          .set('Cookie', cookies[`${role}-ORG-A`])
          .expect(200);
        expect(res.body.data.length).toBeGreaterThan(0);
      }
    });

    it('Aislamiento multi-tenant', async () => {
      const resA = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      const resB = await request(app.getHttpServer())
        .get('/api/inventory')
        .set('Cookie', cookies['COORDINADOR-ORG-B'])
        .expect(200);

      expect(resA.body.meta.total).toBeGreaterThan(0);
      expect(resB.body.meta.total).toBe(0); // ORG-B no tiene inventario
    });

    it('Límite máximo 100', async () => {
      await request(app.getHttpServer())
        .get('/api/inventory?limit=101')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(400);
    });

    it('Ordenamiento whitelist', async () => {
      for (const sortBy of ['sku', 'name', 'onHand', 'reserved', 'available', 'createdAt']) {
        const res = await request(app.getHttpServer())
          .get(`/api/inventory?sortBy=${sortBy}&sortDir=ASC`)
          .set('Cookie', cookies['COORDINADOR-ORG-A'])
          .expect(200);
        expect(res.body.meta).toBeDefined();
      }
    });

    it('sortBy inválido → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/inventory?sortBy=invalidField')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(400);
    });
  });

  describe('GET /requests/:id/history', () => {
    let requestId: string;

    beforeEach(async () => {
      const productIds = await setupInventory(cookies['COORDINADOR-ORG-A']);
      const reqIds = await createRequests(cookies['COORDINADOR-ORG-A'], productIds.map(p => p.id), 5);
      requestId = reqIds[0];
    });

    it('Historial de auditoría de una solicitud', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/requests/${requestId}/history`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      // Debería tener al menos REQUEST_CREATED
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('SOLICITANTE puede ver historial de su propia solicitud', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/requests/${requestId}/history`)
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });

    it('404 si solicitud no existe o es de otra org', async () => {
      // Crear solicitud en ORG-B
      await setupInventory(cookies['COORDINADOR-ORG-B']);
      const productIdsB = await setupInventory(cookies['COORDINADOR-ORG-B']);
      const reqIdsB = await createRequests(cookies['COORDINADOR-ORG-B'], productIdsB.map(p => p.id), 1);

      // Intentar acceder desde ORG-A
      await request(app.getHttpServer())
        .get(`/api/requests/${reqIdsB[0]}/history`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(404);
    });
  });

  // Helper para crear solicitudes (copiado del test anterior)
  async function createRequests(cookie: string, productIds: string[], count: number) {
    const requestIds: string[] = [];
    const userRepo = dataSource.getRepository('users');
    const user = await userRepo.findOne({ where: { email: 'solicitante@org-a.test' } });
    
    for (let i = 1; i <= count; i++) {
      const requestRepo = dataSource.getRepository('requests');
      const requestEntity = requestRepo.create({
        code: `SOL-${i.toString().padStart(6, '0')}`,
        requesterId: user.id,
        organizationId: user.organizationId,
        status: 'BORRADOR',
        priority: 'MEDIA',
        neededBy: new Date(Date.now() + 86400000 * (i + 1)),
        notes: `Solicitud de prueba ${i}`,
      });
      await requestRepo.save(requestEntity);
      
      const items = productIds.slice(0, 2).map((pid, idx) => ({
        requestId: requestEntity.id,
        productId: pid,
        quantity: idx + 1,
      }));
      
      const itemRepo = dataSource.getRepository('request_items');
      for (const item of items) {
        await itemRepo.save(itemRepo.create(item));
      }
      
      requestIds.push(requestEntity.id);
    }
    return requestIds;
  }
});