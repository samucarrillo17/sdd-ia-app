import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { ProductsModule } from './products/products.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { AuditModule } from './audit/audit.module.js';
import { HealthModule } from './health/health.module.js';
import { AiModule } from './ai/ai.module.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { SessionAuthGuard } from './common/guards/session-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.example'],
    }),
    // Disable throttler in test environment
    ...(process.env.NODE_ENV === 'test' ? [] : [ThrottlerModule.forRoot([{ name: 'default', limit: 10, ttl: 60000 }])]),
    DatabaseModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    ProductsModule,
    RequestsModule,
    InventoryModule,
    AuditModule,
    HealthModule,
    AiModule.forRoot(),
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    // Disable throttler guard in test environment
    ...(process.env.NODE_ENV === 'test' ? [] : [{ provide: APP_GUARD, useClass: ThrottlerGuard }]),
  ],
})
export class AppModule {}