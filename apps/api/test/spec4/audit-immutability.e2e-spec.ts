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

describe('SPEC-4: Inmutabilidad Auditoría y Salud (E2E)', () => {
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

  // Helper: setup completo con productos, inventario, solicitudes
  async function setupFullScenario() {
    const productRepo = dataSource.getRepository('products');
    const invRepo = dataSource.getRepository('inventory');
    const orgRepo = dataSource.getRepository('organizations');
    const org = await orgRepo.findOne({ where: { code: 'ORG-A' } });
    const userRepo = dataSource.getRepository('users');
    const user = await userRepo.findOne({ where: { email: 'solicitante@org-a.test' } });

    const productIds: string[] = [];
    for (let i = 1; i <= 10; i++) {
      const product = productRepo.create({
        sku: `SKU-${i.toString().padStart(4, '0')}`,
        name: `Producto ${i}`,
        unit: 'und',
        isActive: true,
        organizationId: org.id,
      });
      await productRepo.save(product);
      
      const inventory = invRepo.create({
        productId: product.id,
        organizationId: org.id,
        onHand: 100,
        reserved: 0,
      });
      await invRepo.save(inventory);
      
      productIds.push(product.id);
    }

    const requestIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const requestRepo = dataSource.getRepository('requests');
      const requestEntity = requestRepo.create({
        code: `SOL-${i.toString().padStart(6, '0')}`,
        requesterId: user.id,
        organizationId: user.organizationId,
        status: 'BORRADOR',
        priority: 'MEDIA',
        neededBy: new Date(Date.now() + 86400000 * (i + 1)),
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

    return { productIds, requestIds, orgId: org.id, userId: user.id };
  }

  describe('Inmutabilidad audit_logs', () => {
    it('INSERT funciona normalmente (crear solicitud genera log)', async () => {
      const { requestIds } = await setupFullScenario();
      
      // Verificar que se creó log de REQUEST_CREATED
      const logs = await dataSource.query(
        "SELECT * FROM audit_logs WHERE action = 'REQUEST_CREATED' ORDER BY created_at DESC LIMIT 1"
      );
      expect(logs.length).toBe(1);
      expect(logs[0].entity_type).toBe('REQUEST');
      expect(logs[0].entity_id).toBe(requestIds[0]);
    });

    it('UPDATE en audit_logs → falla por trigger', async () => {
      await setupFullScenario();
      
      // Obtener un log existente
      const logs = await dataSource.query("SELECT id FROM audit_logs LIMIT 1");
      expect(logs.length).toBeGreaterThan(0);
      const logId = logs[0].id;

      // Intentar UPDATE directo en BD
      await expect(
        dataSource.query(`UPDATE audit_logs SET action = 'HACKED' WHERE id = ${logId}`)
      ).rejects.toThrow(/audit_logs es inmutable/);
    });

    it('DELETE en audit_logs → falla por trigger', async () => {
      await setupFullScenario();
      
      const logs = await dataSource.query("SELECT id FROM audit_logs LIMIT 1");
      expect(logs.length).toBeGreaterThan(0);
      const logId = logs[0].id;

      await expect(
        dataSource.query(`DELETE FROM audit_logs WHERE id = ${logId}`)
      ).rejects.toThrow(/audit_logs es inmutable/);
    });

    it('TRUNCATE en audit_logs → falla por trigger', async () => {
      await setupFullScenario();
      
      await expect(
        dataSource.query('TRUNCATE audit_logs')
      ).rejects.toThrow(/audit_logs es inmutable/);
    });
  });

  describe('Auditoría de escrituras SPEC-1/2/3', () => {
    it('Login genera LOGIN audit log', async () => {
      // Login ya se hizo en beforeAll, verificar que existe
      const logs = await dataSource.query(
        "SELECT * FROM audit_logs WHERE action = 'LOGIN' ORDER BY created_at DESC LIMIT 1"
      );
      expect(logs.length).toBeGreaterThan(0);
      expect(logs[0].action).toBe('LOGIN');
      expect(logs[0].after).toHaveProperty('userId');
    });

    it('Logout genera LOGOUT audit log', async () => {
      // Hacer logout y verificar
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);

      const logs = await dataSource.query(
        "SELECT * FROM audit_logs WHERE action = 'LOGOUT' ORDER BY created_at DESC LIMIT 1"
      );
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('LOGOUT');
      expect(logs[0].before).toHaveProperty('sessionId');
    });

    it('Crear solicitud genera REQUEST_CREATED', async () => {
      const { requestIds } = await setupFullScenario();
      
      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestIds[0]}' AND action = 'REQUEST_CREATED'`
      );
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('REQUEST_CREATED');
      expect(logs[0].after).toHaveProperty('code');
      expect(logs[0].after).toHaveProperty('status', 'BORRADOR');
    });

    it('Enviar solicitud genera REQUEST_SUBMITTED', async () => {
      const { requestIds } = await setupFullScenario();
      const requestId = requestIds[0];

      // Enviar solicitud como SOLICITANTE
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/submit`)
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);

      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestId}' AND action = 'REQUEST_SUBMITTED'`
      );
      expect(logs.length).toBe(1);
      expect(logs[0].before).toHaveProperty('status', 'BORRADOR');
      expect(logs[0].after).toHaveProperty('status', 'ENVIADA');
    });

    it('Reservar stock genera REQUEST_RESERVED', async () => {
      const { requestIds } = await setupFullScenario();
      const requestId = requestIds[0];

      // Enviar primero
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/submit`)
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);

      // Reservar como COORDINADOR con Idempotency-Key
      const idempotencyKey = 'test-key-' + Date.now();
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/reserve`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .set('Idempotency-Key', idempotencyKey)
        .expect(200);

      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestId}' AND action = 'REQUEST_RESERVED'`
      );
      expect(logs.length).toBe(1);
      expect(logs[0].after).toHaveProperty('status', 'RESERVADA');
    });

    it('Despachar genera REQUEST_DISPATCHED', async () => {
      const { requestIds } = await setupFullScenario();
      const requestId = requestIds[0];

      // Enviar + Reservar
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/submit`)
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);
      
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/reserve`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .set('Idempotency-Key', 'test-key-' + Date.now())
        .expect(200);

      // Despachar como BODEGA
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/dispatch`)
        .set('Cookie', cookies['BODEGA-ORG-A'])
        .expect(200);

      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestId}' AND action = 'REQUEST_DISPATCHED'`
      );
      expect(logs.length).toBe(1);
      expect(logs[0].after).toHaveProperty('status', 'DESPACHADA');
    });

    it('Entregar genera REQUEST_DELIVERED', async () => {
      const { requestIds } = await setupFullScenario();
      const requestId = requestIds[0];

      // Flujo completo: submit → reserve → dispatch → deliver
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/submit`)
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);
      
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/reserve`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .set('Idempotency-Key', 'test-key-' + Date.now())
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/dispatch`)
        .set('Cookie', cookies['BODEGA-ORG-A'])
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/deliver`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);

      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestId}' AND action = 'REQUEST_DELIVERED'`
      );
      expect(logs.length).toBe(1);
      expect(logs[0].after).toHaveProperty('status', 'ENTREGADA');
    });

    it('Cancelar genera REQUEST_CANCELLED', async () => {
      const { requestIds } = await setupFullScenario();
      const requestId = requestIds[0];

      // Cancelar en BORRADOR
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/cancel`)
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(200);

      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestId}' AND action = 'REQUEST_CANCELLED'`
      );
      expect(logs.length).toBe(1);
      expect(logs[0].after).toHaveProperty('status', 'CANCELADA');
    });

    it('Si transacción falla, no queda registro de auditoría', async () => {
      const { requestIds } = await setupFullScenario();
      const requestId = requestIds[0];

      // Intentar reservar sin enviar (debe fallar con 409)
      await request(app.getHttpServer())
        .post(`/api/requests/${requestId}/reserve`)
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .set('Idempotency-Key', 'test-key-fail-' + Date.now())
        .expect(409);

      // Verificar que NO hay REQUEST_RESERVED
      const logs = await dataSource.query(
        `SELECT * FROM audit_logs WHERE entity_id = '${requestId}' AND action = 'REQUEST_RESERVED'`
      );
      expect(logs.length).toBe(0);
    });
  });

  describe('Control de acceso /audit-logs', () => {
    beforeEach(async () => {
      await setupFullScenario();
    });

    it('COORDINADOR puede acceder a /audit-logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/audit-logs')
        .set('Cookie', cookies['COORDINADOR-ORG-A'])
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('AUDITOR puede acceder a /audit-logs', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/audit-logs')
        .set('Cookie', cookies['AUDITOR-ORG-A'])
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('SOLICITANTE → 403 en /audit-logs', async () => {
      await request(app.getHttpServer())
        .get('/api/audit-logs')
        .set('Cookie', cookies['SOLICITANTE-ORG-A'])
        .expect(403);
    });

    it('BODEGA → 403 en /audit-logs', async () => {
      await request(app.getHttpServer())
        .get('/api/audit-logs')
        .set('Cookie', cookies['BODEGA-ORG-A'])
        .expect(403);
    });
  });

  describe('Endpoints de salud', () => {
    it('GET /health → 200 sin sesión (liveness)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.info.api.status).toBe('up');
    });

    it('GET /ready → 200 con BD disponible (readiness)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/ready')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.info.database.status).toBe('up');
      expect(res.body.info.migrations.status).toBe('up');
    });

    it('GET /health y /ready son públicos (sin cookie)', async () => {
      await request(app.getHttpServer()).get('/api/health').expect(200);
      await request(app.getHttpServer()).get('/api/ready').expect(200);
    });

    it('/ready → 503 cuando BD no disponible', async () => {
      // Cerrar conexión a BD para simular indisponibilidad
      await dataSource.destroy();
      
      const res = await request(app.getHttpServer())
        .get('/api/ready')
        .expect(503);

      expect(res.body.status).toBe('error');
      expect(res.body.error.database.status).toBe('down');
      
      // Recrear conexión para siguientes tests
      // Nota: en un entorno real esto requeriría reiniciar la app
      // Para este test, verificamos el comportamiento
    });
  });
});