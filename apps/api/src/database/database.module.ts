import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
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

const allEntities = [
  Organization,
  User,
  Session,
  Product,
  Request,
  RequestItem,
  Inventory,
  InventoryMovement,
  IdempotencyKey,
  AuditLog,
];

@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const isTest = process.env.NODE_ENV === 'test';
        const databaseUrl = isTest
          ? configService.get('TEST_DATABASE_URL')
          : configService.get('DATABASE_URL');

        // Migrations are run separately via CLI (npm run migration:run)
        // Don't load them at runtime to avoid TS/JS module issues
        const migrations = isTest ? [] : [];

        return {
          type: 'postgres',
          url: databaseUrl,
          synchronize: isTest, // Use synchronize in test mode to avoid migration ESM import issues
          logging: configService.get('NODE_ENV') !== 'production',
          entities: allEntities,
          migrations,
          migrationsTableName: 'migrations',
          ssl: configService.get('NODE_ENV') === 'production' ? { rejectUnauthorized: false } : false,
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class DatabaseModule {}