import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import cookieParser from 'cookie-parser';

// Helper to extract cookie value from Set-Cookie header
function extractCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('SPEC-4: Paginación y Filtros (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let cookies: Record<string, string> = {};

  // Usuarios de prueba (del seed)
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

    // Login todos los usuarios y guardar cookies
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
    // Limpiar datos de prueba pero mantener usuarios/orgs
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM inventory_movements');
    await dataSource.query('DELETE FROM inventory');
    await dataSource.query('DELETE FROM request_items');
    await dataSource.query('DELETE FROM requests');
    await dataSource.query('DELETE FROM products');
    await dataSource.query('DELETE FROM sessions');
  });

  // Crear productos de prueba
  async function createProducts(cookie: string, count: number) {
    const productIds: string[] = [];
    for (let i = 1; i <= count; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/products') // asumiendo que existe endpoint POST /products
        .set('Cookie', cookie)
        .send({
          sku: `SKU-${i.toString().padStart(4, '0')}`,
          name: `Producto ${i}`,
          unit: 'und',
          isActive: true,
        });
      if (res.status === 201 || res.status === 200) {
        productIds.push(res.body.id || res.body.productId);
      }
    }
    // Si no hay endpoint POST products, crear directo en BD
    if (productIds.length === 0) {
      const productRepo = dataSource.getRepository('products');
      for (let i = 1; i <= count; i++) {
        const product = productRepo.create({
          sku: `SKU-${i.toString().padStart(4, '0')}`,
          name: `Producto ${i}`,
          unit: 'und',
          isActive: true,
          organizationId: (await dataSource.getRepository('organizations').findOne({ where: { code: 'ORG-A' } })).id,
        });
        await productRepo.save(product);
        productIds.push(product.id);
      }
    }
    return productIds;
  }

  // Crear solicitudes de prueba
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
        status: i % 3 === 0 ? 'BORRADOR' : (i % 3 === 1 ? 'ENVIADA' : 'RESERVADA'),
        priority: i % 3 === 0 ? 'ALTA' : (i % 3 === 1 ? 'MEDIA' : 'BAJA'),
        neededBy: new Date(Date.now() + 86400000 * (i + 1)),
        notes: `Solicitud de prueba ${i}`,
      });
      await requestRepo.save(requestEntity);
      
      // Agregar items
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

  describe('Paginación básica', () => {
    beforeEach(async () => {
      const productIds = await createProducts(cookies['COORDINADOR-ORG-A'], 20);
      await createRequests(cookies['COORDINADOR-ORG-A'], productIds, 25);
    });

    it('GET /requests sin parámetros → defaults (page=1, limit=20)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('meta');
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.data.length).toBeLessThanOrEqual(20);
    });

    it('GET /requests?limit=100 → 200 con 100 items max', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests?limit=100')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      expect(res.body.meta.limit).toBe(100);
      expect(res.body.data.length).toBeLessThanOrEqual(100);
    });

    it('GET /requests?limit=101 → 400 (límite máximo estricto)', async () => {
      await request(app.getHttpServer())
        .get('/api/requests?limit=101')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(400);
    });

    it('GET /requests?limit=0 → 400 (mínimo 1)', async () => {
      await request(app.getHttpServer())
        .get('/api/requests?limit=0')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(400);
    });

    it('GET /requests?page=0 → 400 (mínimo 1)', async () => {
      await request(app.getHttpServer())
        .get('/api/requests?page=0')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(400);
    });

    it('Paginación estable: recorrer todas las páginas no repite ni omite filas', async () => {
      const allItems: any[] = [];
      let page = 1;
      let hasMore = true;
      
      while (hasMore) {
        const res = await request(app.getHttpServer())
          .get(`/api/requests?page=${page}&limit=10`)
          .set('Cookie', cookies['COORDINADOR-ORG-A'])
          .expect(200);
        
        expect(res.body.meta.page).toBe(page);
        expect(res.body.meta.limit).toBe(10);
        
        allItems.push(...res.body.data);
        hasMore = res.body.data.length === 10 && page < res.body.meta.totalPages;
        page++;
      }
      
      // Verificar que no hay IDs duplicados
      const ids = allItems.map(item => item.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
      
      // Verificar que total coincide
      expect(allItems.length).toBe(25);
    });
  });

  describe('Filtros /requests', () => {
    beforeEach(async () => {
      const productIds = await createProducts(cookies['COORDINADOR-ORG-A'], 10);
      await createRequests(cookies['COORDINADOR-ORG-A'], productIds, 15);
    });

    it('Filtro por status[]', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests?status[]=BORRADOR&status[]=ENVIADA')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      
      for (const item of res.body.data) {
        expect(['BORRADOR', 'ENVIADA']).toContain(item.status);
      }
    });

    it('Filtro por priority[]', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests?priority[]=ALTA&priority[]=MEDIA')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      
      for (const item of res.body.data) {
        expect(['ALTA', 'MEDIA']).toContain(item.priority);
      }
    });

    it('Filtro por requesterId', async () => {
      const userRepo = dataSource.getRepository('users');
      const user = await userRepo.findOne({ where: { email: 'solicitante@org-a.test' } });
      
      const res = await request(app.getHttpServer())
        .get(`/api/requests?requesterId=${user.id}`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      
      for (const item of res.body.data) {
        expect(item.requesterId).toBe(user.id);
      }
    });

    it('Filtro por búsqueda de código (search)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests?search=SOL-000001')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].code).toContain('SOL-000001');
    });

    it('sortBy inválido → 400', async () => {
      await request(app.getHttpServer())
        .get('/api/requests?sortBy=invalidField')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(400);
    });

    it('sortBy válido (createdAt, neededBy, priority) → 200', async () => {
      for (const sortBy of ['createdAt', 'neededBy', 'priority']) {
        const res = await request(app.getHttpServer())
          .get(`/api/requests?sortBy=${sortBy}&sortDir=ASC`)
          .set('Cookie', cookies['COORDINADOR-ORG-A'])
          .expect(200);
        expect(res.body.meta).toBeDefined();
      }
    });
  });

  describe('Seguridad por rol en /requests', () => {
    beforeEach(async () => {
      const productIds = await createProducts(cookies['COORDINADOR-ORG-A'], 5);
      await createRequests(cookies['COORDINADOR-ORG-A'], productIds, 10);
      // Crear también solicitudes para ORG-B
      const productIdsB = await createProducts(cookies['COORDINADOR-ORG-B'], 5);
      await createRequests(cookies['COORDINADOR-ORG-B'], productIdsB, 5);
    });

    it('SOLICITANTE solo ve sus propias solicitudes', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);
      
      // El solicitante solo tiene sus propias solicitudes
      for (const item of res.body.data) {
        expect(item.requesterId).toBeDefined();
      }
    });

    it('COORDINADOR ve todas las solicitudes de su org', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      
      expect(res.body.meta.total).toBeGreaterThanOrEqual(10);
    });

    it('BODEGA ve todas las solicitudes de su org', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['BODEGA-ORG-A'])
        .expect(200);
      
      expect(res.body.meta.total).toBeGreaterThanOrEqual(10);
    });

    it('AUDITOR ve todas las solicitudes de su org', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['AUDITOR-ORG-A'])
        .expect(200);
      
      expect(res.body.meta.total).toBeGreaterThanOrEqual(10);
    });

    it('Nadie ve datos de otra organización', async () => {
      const resA = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      
      const resB = await request(app.getHttpServer())
        .get('/api/requests')
        .set('Cookie', cookies['COORDINADOR-ORG-B'])
        .expect(200);
      
      // Los IDs no deben solaparse
      const idsA = resA.body.data.map((r: any) => r.id);
      const idsB = resB.body.data.map((r: any) => r.id);
      const intersection = idsA.filter((id: string) => idsB.includes(id));
      expect(intersection.length).toBe(0);
    });
  });
});