import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Organization } from '../organizations/organization.entity.js';
import { User } from '../users/user.entity.js';

export enum AuditEntityType {
  REQUEST = 'REQUEST',
  INVENTORY = 'INVENTORY',
  USER = 'USER',
  PRODUCT = 'PRODUCT',
  SESSION = 'SESSION',
  ORGANIZATION = 'ORGANIZATION',
}

export enum AuditAction {
  // Auth
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',

  // Requests
  REQUEST_CREATED = 'REQUEST_CREATED',
  REQUEST_UPDATED = 'REQUEST_UPDATED',
  REQUEST_DELETED = 'REQUEST_DELETED',
  REQUEST_SUBMITTED = 'REQUEST_SUBMITTED',
  REQUEST_RESERVED = 'REQUEST_RESERVED',
  REQUEST_DISPATCHED = 'REQUEST_DISPATCHED',
  REQUEST_DELIVERED = 'REQUEST_DELIVERED',
  REQUEST_CANCELLED = 'REQUEST_CANCELLED',

  // Inventory
  STOCK_RESERVED = 'STOCK_RESERVED',
  STOCK_RELEASED = 'STOCK_RELEASED',
  STOCK_DISPATCHED = 'STOCK_DISPATCHED',
  STOCK_ADJUSTED = 'STOCK_ADJUSTED',

  // Users
  USER_CREATED = 'USER_CREATED',
  USER_UPDATED = 'USER_UPDATED',
  USER_DEACTIVATED = 'USER_DEACTIVATED',
}

@Entity('audit_logs')
@Index(['organizationId', 'entityType', 'entityId', 'createdAt'])
@Index(['actorUserId'])
@Index(['action'])
@Index(['requestId'])
@Index(['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column('uuid', { name: 'organization_id' })
  organizationId: string;

  @ManyToOne(() => Organization)
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column('uuid', { name: 'actor_user_id', nullable: true })
  actorUserId: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'actor_user_id' })
  actorUser: User | null;

  @Column('varchar', { length: 40, name: 'entity_type' })
  entityType: AuditEntityType | string;

  @Column('uuid', { name: 'entity_id' })
  entityId: string;

  @Column('varchar', { length: 60 })
  action: AuditAction | string;

  @Column('jsonb', { name: 'before', nullable: true })
  before: Record<string, unknown> | null;

  @Column('jsonb', { name: 'after', nullable: true })
  after: Record<string, unknown> | null;

  @Column('varchar', { length: 64, name: 'request_id', nullable: true })
  requestId: string | null;

  @Column('inet', { nullable: true })
  ip: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Intencionalmente NO hay @UpdateDateColumn — la tabla es inmutable
  // Intencionalmente NO hay @DeleteDateColumn — no se permite borrado
}