import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import type { Organization } from '../organizations/organization.entity.js';

@Entity('idempotency_keys')
@Unique(['organizationId', 'endpoint', 'key'])
@Index(['organizationId'])
@Index(['createdAt'])
export class IdempotencyKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @ManyToOne('Organization', { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization;

  @Column({ length: 100 })
  key: string;

  @Column({ name: 'endpoint', length: 120 })
  endpoint: string;

  @Column({ name: 'request_hash', length: 64 })
  requestHash: string;

  @Column({
    type: 'enum',
    enum: ['IN_PROGRESS', 'COMPLETED'],
    default: 'IN_PROGRESS',
  })
  status: 'IN_PROGRESS' | 'COMPLETED';

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus: number | null;

  @Column({ name: 'response_body', type: 'jsonb', nullable: true })
  responseBody: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}