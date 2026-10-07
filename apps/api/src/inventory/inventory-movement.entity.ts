import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { Organization } from '../organizations/organization.entity.js';
import type { Product } from '../products/product.entity.js';
import type { Request } from '../requests/entities/request.entity.js';
import type { User } from '../users/user.entity.js';

export enum InventoryMovementType {
  RESERVA = 'RESERVA',
  LIBERACION = 'LIBERACION',
  DESPACHO = 'DESPACHO',
  AJUSTE = 'AJUSTE',
}

@Entity('inventory_movements')
@Index(['organizationId'])
@Index(['organizationId', 'productId'])
@Index(['requestId'])
@Index(['createdAt'])
export class InventoryMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne('Product', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ name: 'request_id', type: 'uuid', nullable: true })
  requestId: string | null;

  @ManyToOne('Request', { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'request_id' })
  request: Request | null;

  @Column({
    type: 'enum',
    enum: InventoryMovementType,
  })
  type: InventoryMovementType;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @ManyToOne('User', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: User;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}