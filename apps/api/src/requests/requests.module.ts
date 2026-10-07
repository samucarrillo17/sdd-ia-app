import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Request } from './entities/request.entity.js';
import { RequestItem } from './entities/request-item.entity.js';
import { Product } from '../products/product.entity.js';
import { User } from '../users/user.entity.js';
import { RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { IdempotencyModule } from '../idempotency/idempotency.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Request, RequestItem, Product, User]),
    InventoryModule,
    IdempotencyModule,
    AuditModule,
  ],
  controllers: [RequestsController],
  providers: [RequestsService],
  exports: [RequestsService],
})
export class RequestsModule {}