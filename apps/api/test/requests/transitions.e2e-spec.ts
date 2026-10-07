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

describe('Invalid State Transitions Tests (E2E)', () => {
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

  let requestIds: {
    borrador: string;
    enviada: string;
    reservada: string;
    despachada: string;
    entregada: string;
    cancelada: string;
  } = {
    borrador: '',
    enviada: '',
    reservada: '',
    despachada: '',
    entregada: '',
    cancelada: '',
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

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const neededBy = tomorrow.toISOString().split('T')[0];

    const createRequest = async (agent: request.SuperAgentTest) => {
      const res = await agent
        .post('/api/requests')
        .send({
          priority: 'MEDIA',
          neededBy,
          items: [{ productId: products.productA1, quantity: 1 }],
        })
        .expect(201);
      return res.body.request.id;
    };

    requestIds.borrador = await createRequest(agentSolA);
    requestIds.enviada = await createRequest(agentSolA);
    requestIds.reservada = await createRequest(agentSolA);
    requestIds.despachada = await createRequest(agentSolA);
    requestIds.entregada = await createRequest(agentSolA);
    requestIds.cancelada = await createRequest(agentSolA);

    await agentSolA
      .post(`/api/requests/${requestIds.enviada}/submit`)
      .expect(200);

    await agentSolA
      .post(`/api/requests/${requestIds.reservada}/submit`)
      .expect(200);
    await agentCoord
      .post(`/api/requests/${requestIds.reservada}/reserve`)
      .set('Idempotency-Key', '55555555-5555-5555-5555-555555555555')
      .send({})
      .expect(200);

    await agentSolA
      .post(`/api/requests/${requestIds.despachada}/submit`)
      .expect(200);
    await agentCoord
      .post(`/api/requests/${requestIds.despachada}/reserve`)
      .set('Idempotency-Key', '66666666-6666-6666-6666-666666666666')
      .send({})
      .expect(200);
    await agentBodega
      .post(`/api/requests/${requestIds.despachada}/dispatch`)
      .send({})
      .expect(200);

    await agentSolA
      .post(`/api/requests/${requestIds.entregada}/submit`)
      .expect(200);
    await agentCoord
      .post(`/api/requests/${requestIds.entregada}/reserve`)
      .set('Idempotency-Key', '77777777-7777-7777-7777-777777777777')
      .send({})
      .expect(200);
    await agentBodega
      .post(`/api/requests/${requestIds.entregada}/dispatch`)
      .send({})
      .expect(200);
    await agentCoord
      .post(`/api/requests/${requestIds.entregada}/deliver`)
      .send({})
      .expect(200);

    await agentSolA
      .post(`/api/requests/${requestIds.cancelada}/submit`)
      .expect(200);
    await agentSolA
      .post(`/api/requests/${requestIds.cancelada}/cancel`)
      .send({})
      .expect(200);
  });

  describe('8. Transiciones inválidas → 409 INVALID_STATE_TRANSITION', () => {
    const invalidTransitions = [
      { state: 'enviada', action: 'dispatch', agent: 'agentBodega', desc: 'Despachar ENVIADA (debe ser RESERVADA)' },
      { state: 'enviada', action: 'deliver', agent: 'agentCoord', desc: 'Entregar ENVIADA (debe ser DESPACHADA)' },
      { state: 'reservada', action: 'deliver', agent: 'agentCoord', desc: 'Entregar RESERVADA (debe ser DESPACHADA)' },
      { state: 'despachada', action: 'reserve', agent: 'agentCoord', desc: 'Reservar DESPACHADA (ya reservada)' },
      { state: 'entregada', action: 'reserve', agent: 'agentCoord', desc: 'Reservar ENTREGADA' },
      { state: 'entregada', action: 'dispatch', agent: 'agentBodega', desc: 'Despachar ENTREGADA' },
      { state: 'entregada', action: 'deliver', agent: 'agentCoord', desc: 'Entregar ENTREGADA' },
      { state: 'cancelada', action: 'reserve', agent: 'agentCoord', desc: 'Reservar CANCELADA' },
      { state: 'cancelada', action: 'dispatch', agent: 'agentBodega', desc: 'Despachar CANCELADA' },
      { state: 'cancelada', action: 'deliver', agent: 'agentCoord', desc: 'Entregar CANCELADA' },
      { state: 'cancelada', action: 'cancel', agent: 'agentCoord', desc: 'Cancelar CANCELADA' },
    ];

    for (const { state, action, agent: agentName, desc } of invalidTransitions) {
      it(`${desc} → 409`, async () => {
        const requestId = requestIds[state as keyof typeof requestIds];
        const agent = (this as any)[agentName] as request.SuperAgentTest;
        const endpoint = `/api/requests/${requestId}/${action}`;

        let res;
        if (action === 'reserve') {
          res = await agent
            .post(endpoint)
            .set('Idempotency-Key', '88888888-8888-8888-8888-888888888888')
            .send({})
            .expect(409);
        } else {
          res = await agent
            .post(endpoint)
            .send({})
            .expect(409);
        }

        expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
      });
    }

    it('SOLICITANTE no puede cancelar RESERVADA (solo COORDINADOR)', async () => {
      const res = await agentSolA
        .post(`/api/requests/${requestIds.reservada}/cancel`)
        .send({})
        .expect(403);

      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('SOLICITANTE no puede cancelar DESPACHADA', async () => {
      const res = await agentSolA
        .post(`/api/requests/${requestIds.despachada}/cancel`)
        .send({})
        .expect(409);

      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    });

    it('COORDINADOR no puede cancelar ENTREGADA', async () => {
      const res = await agentCoord
        .post(`/api/requests/${requestIds.entregada}/cancel`)
        .send({})
        .expect(409);

      expect(res.body.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  describe('Estados terminales: DESPACHADA, ENTREGADA, CANCELADA no se pueden cancelar ni modificar', () => {
    const terminalStates = ['despachada', 'entregada', 'cancelada'];

    for (const state of terminalStates) {
      it(`no se puede actualizar una solicitud en ${state}`, async () => {
        const requestId = requestIds[state as keyof typeof requestIds];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 2);
        const neededBy = tomorrow.toISOString().split('T')[0];

        const res = await agentSolA
          .put(`/api/requests/${requestId}`)
          .send({
            priority: 'ALTA',
            neededBy,
            items: [{ productId: products.productA1, quantity: 1 }],
          })
          .expect(409);

        expect(res.body.code).toBe('INVALID_STATE');
      });

      it(`no se puede eliminar una solicitud en ${state}`, async () => {
        const requestId = requestIds[state as keyof typeof requestIds];

        const res = await agentSolA
          .delete(`/api/requests/${requestId}`)
          .expect(409);

        expect(res.body.code).toBe('INVALID_STATE');
      });
    }
  });
});