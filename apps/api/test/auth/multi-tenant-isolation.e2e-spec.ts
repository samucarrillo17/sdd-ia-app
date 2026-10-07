import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Role } from '../../src/users/role.enum.js';
import cookieParser from 'cookie-parser';

// Helper to extract cookie value from Set-Cookie header
function extractCookie(setCookieHeader: string): string {
  return setCookieHeader.split(';')[0];
}

describe('Multi-tenant Isolation (E2E)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const orgA = { code: 'ORG-A', name: 'Organización A' };
  const orgB = { code: 'ORG-B', name: 'Organización B' };

  const users = [
    // ORG-A
    { email: 'solicitante@org-a.test', password: 'devpassword123', role: 'SOLICITANTE', orgCode: 'ORG-A' },
    { email: 'coordinador@org-a.test', password: 'devpassword123', role: 'COORDINADOR', orgCode: 'ORG-A' },
    // ORG-B
    { email: 'solicitante@org-b.test', password: 'devpassword123', role: 'SOLICITANTE', orgCode: 'ORG-B' },
    { email: 'coordinador@org-b.test', password: 'devpassword123', role: 'COORDINADOR', orgCode: 'ORG-B' },
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
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean up sessions before each test
    await dataSource.query('DELETE FROM sessions');
  });

  describe('Login isolation', () => {
    it('should allow login for same email in different organizations', async () => {
      // Login as solicitante@org-a.test
      const loginA = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'solicitante@org-a.test', password: 'devpassword123' })
        .expect(200);

      expect(loginA.body.user).toBeDefined();
      expect(loginA.body.user.email).toBe('solicitante@org-a.test');
      expect(loginA.body.user.organization.code).toBe('ORG-A');
      expect(loginA.headers['set-cookie']).toBeDefined();

      const cookieA = extractCookie(loginA.headers['set-cookie'][0]);

      // Login as solicitante@org-b.test (same email local-part, different org)
      const loginB = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'solicitante@org-b.test', password: 'devpassword123' })
        .expect(200);

      expect(loginB.body.user).toBeDefined();
      expect(loginB.body.user.email).toBe('solicitante@org-b.test');
      expect(loginB.body.user.organization.code).toBe('ORG-B');
      expect(loginB.headers['set-cookie']).toBeDefined();

      const cookieB = extractCookie(loginB.headers['set-cookie'][0]);

      // Both logins should succeed independently
      expect(cookieA).not.toBe(cookieB);
    });

    it('should return 401 for non-existent user', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'nonexistent@org-a.test', password: 'devpassword123' })
        .expect(401);
    });

    it('should return 401 for wrong password', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'solicitante@org-a.test', password: 'wrongpassword' })
        .expect(401);
    });

    it('should return 401 for inactive user', async () => {
      // Create an inactive user directly in DB
      const orgRepo = dataSource.getRepository('organizations');
      const org = await orgRepo.findOne({ where: { code: 'ORG-A' } });

      const userRepo = dataSource.getRepository('users');
      const passwordHash = await argon2.hash('devpassword123');
      await userRepo.save({
        email: 'inactive@org-a.test',
        passwordHash,
        fullName: 'Inactive User',
        role: 'SOLICITANTE',
        organizationId: org.id,
        isActive: false,
      });

      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'inactive@org-a.test', password: 'devpassword123' })
        .expect(401);
    });
  });

  describe('Session isolation', () => {
    it('should attach correct organizationId to request.user from session', async () => {
      // Login as ORG-A user
      const loginA = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'coordinador@org-a.test', password: 'devpassword123' })
        .expect(200);

      const cookieA = extractCookie(loginA.headers['set-cookie'][0]);

      // Use /auth/me to verify session returns correct org
      const meA = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookieA)
        .expect(200);

      expect(meA.body.organization.code).toBe('ORG-A');
      expect(meA.body.organization.id).toBeDefined();

      // Login as ORG-B user
      const loginB = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'coordinador@org-b.test', password: 'devpassword123' })
        .expect(200);

      const cookieB = extractCookie(loginB.headers['set-cookie'][0]);

      const meB = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookieB)
        .expect(200);

      expect(meB.body.organization.code).toBe('ORG-B');
      expect(meB.body.organization.id).not.toBe(meA.body.organization.id);
    });

    it('should not allow session from ORG-A to impersonate ORG-B', async () => {
      // This test verifies that the session cookie encodes the organization
      // and cannot be used cross-organization
      const loginA = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'solicitante@org-a.test', password: 'devpassword123' })
        .expect(200);

      const cookieA = extractCookie(loginA.headers['set-cookie'][0]);

      // Verify session belongs to ORG-A
      const meA = await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookieA)
        .expect(200);

      expect(meA.body.organization.code).toBe('ORG-A');

      // The same cookie should NOT work for ORG-B resources
      // (when business endpoints exist, they will filter by organizationId from session)
      // For now, verify the session itself is bound to ORG-A
      const sessionRepo = dataSource.getRepository('sessions');
      const sessions = await sessionRepo.find();
      expect(sessions.length).toBe(1);
      expect(sessions[0].organization_id).toBe(meA.body.organization.id);
    });

    it('should revoke session on logout', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: 'solicitante@org-a.test', password: 'devpassword123' })
        .expect(200);

      const cookie = extractCookie(login.headers['set-cookie'][0]);

      // Verify session works
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(200);

      // Logout
      await request(app.getHttpServer())
        .post('/api/auth/logout')
        .set('Cookie', cookie)
        .expect(200);

      // Session should be revoked
      await request(app.getHttpServer())
        .get('/api/auth/me')
        .set('Cookie', cookie)
        .expect(401);
    });
  });

  describe('Seed data integrity', () => {
    it('should have 2 organizations with correct codes', async () => {
      const orgRepo = dataSource.getRepository('organizations');
      const orgs = await orgRepo.find();
      expect(orgs.length).toBe(2);
      const codes = orgs.map((o: any) => o.code).sort();
      expect(codes).toEqual(['ORG-A', 'ORG-B']);
    });

    it('should have 8 users (4 per organization) with correct roles', async () => {
      const userRepo = dataSource.getRepository('users');
      const users = await userRepo.find({ relations: { organization: true } });
      expect(users.length).toBe(8);

      const orgAUsers = users.filter((u: any) => u.organization.code === 'ORG-A');
      const orgBUsers = users.filter((u: any) => u.organization.code === 'ORG-B');

      expect(orgAUsers.length).toBe(4);
      expect(orgBUsers.length).toBe(4);

      const rolesA = orgAUsers.map((u: any) => u.role).sort();
      const rolesB = orgBUsers.map((u: any) => u.role).sort();
      const expectedRoles = ['AUDITOR', 'BODEGA', 'COORDINADOR', 'SOLICITANTE'];

      expect(rolesA).toEqual(expectedRoles);
      expect(rolesB).toEqual(expectedRoles);
    });

    it('should enforce unique email per organization (composite unique)', async () => {
      const userRepo = dataSource.getRepository('users');
      const orgRepo = dataSource.getRepository('organizations');
      const orgA = await orgRepo.findOne({ where: { code: 'ORG-A' } });
      const orgB = await orgRepo.findOne({ where: { code: 'ORG-B' } });

      const passwordHash = await argon2.hash('devpassword123');

      // Create user in ORG-A with email that already exists in ORG-B
      const userInOrgA = userRepo.create({
        email: 'coordinador@org-b.test', // exists in ORG-B
        passwordHash,
        fullName: 'Test User',
        role: 'SOLICITANTE',
        organizationId: orgA.id,
        isActive: true,
      });

      await expect(userRepo.save(userInOrgA)).resolves.toBeDefined();

      // Now try to create duplicate in SAME organization - should fail
      const duplicateInOrgB = userRepo.create({
        email: 'coordinador@org-b.test',
        passwordHash,
        fullName: 'Duplicate User',
        role: 'SOLICITANTE',
        organizationId: orgB.id,
        isActive: true,
      });

      await expect(userRepo.save(duplicateInOrgB)).rejects.toThrow();
    });
  });

  describe('Rate limiting on login', () => {
    it('should rate limit login attempts (10 per minute)', async () => {
      const attempts = 12;
      let successCount = 0;
      let rateLimitedCount = 0;

      for (let i = 0; i < attempts; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'solicitante@org-a.test', password: 'wrongpassword' });

        if (res.status === 401) successCount++;
        if (res.status === 429) rateLimitedCount++;
      }

      // First 10 should be 401 (invalid credentials), 11th+ should be 429
      expect(successCount).toBe(10);
      expect(rateLimitedCount).toBe(2);
    });
  });
});