import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
  Index,
  Unique,
} from 'typeorm';
import type { User } from '../../users/user.entity.js';
import type { RequestItem } from './request-item.entity.js';
import { RequestStatus } from '../enums/request-status.enum.js';
import { Priority } from '../enums/priority.enum.js';

@Entity('requests')
@Unique(['organizationId', 'code'])
@Index(['organizationId'])
@Index(['organizationId', 'status'])
@Index(['organizationId', 'requesterId'])
@Index(['organizationId', 'createdAt'])
export class Request {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @Column({ length: 20 })
  code: string;

  @Column({ name: 'requester_id', type: 'uuid' })
  requesterId: string;

  @ManyToOne('User', 'requests', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'requester_id' })
  requester: User;

  @Column({
    type: 'enum',
    enum: RequestStatus,
    default: RequestStatus.BORRADOR,
  })
  status: RequestStatus;

  @Column({
    type: 'enum',
    enum: Priority,
    default: Priority.MEDIA,
  })
  priority: Priority;

  @Column({ name: 'needed_by', type: 'date' })
  neededBy: Date;

  @Column({ name: 'notes', type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @OneToMany('RequestItem', 'request', { cascade: true })
  items: RequestItem[];
}