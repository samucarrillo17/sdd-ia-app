import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from 'dotenv';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';
import { Session } from '../auth/session.entity.js';
import { Product } from '../products/product.entity.js';
import { Request } from '../requests/entities/request.entity.js';
import { RequestItem } from '../requests/entities/request-item.entity.js';
import { Inventory } from '../inventory/inventory.entity.js';
import { InventoryMovement } from '../inventory/inventory-movement.entity.js';
import { IdempotencyKey } from '../idempotency/idempotency-key.entity.js';
import { AuditLog } from '../audit/audit-log.entity.js';

config();

const isTest = process.env.NODE_ENV === 'test';

const databaseUrl = isTest
  ? process.env.TEST_DATABASE_URL
  : process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    isTest
      ? 'TEST_DATABASE_URL no está configurada'
      : 'DATABASE_URL no está configurada',
  );
}

// Migrations are run separately via CLI (npm run migration:run)
// Don't load them at runtime to avoid TS/JS module issues
const migrations = isTest ? ['src/database/migrations/*.ts'] : [];

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: databaseUrl,
  synchronize: false,
  logging: process.env.NODE_ENV !== 'production',
  entities: [Organization, User, Session, Product, Request, RequestItem, Inventory, InventoryMovement, IdempotencyKey, AuditLog],
  migrations,
  migrationsTableName: 'migrations',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
};

export const AppDataSource = new DataSource(dataSourceOptions);