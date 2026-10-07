import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Inventory } from './inventory.entity.js';
import { InventoryMovement } from './inventory-movement.entity.js';
import { InventoryService } from './inventory.service.js';
import { InventoryController } from './inventory.controller.js';
import { Product } from '../products/product.entity.js';
import { Request } from '../requests/entities/request.entity.js';
import { RequestItem } from '../requests/entities/request-item.entity.js';
import { User } from '../users/user.entity.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Inventory, InventoryMovement, Product, Request, RequestItem, User]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}