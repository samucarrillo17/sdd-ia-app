import { Expose } from 'class-transformer';
import { RequestItemResponseDto } from './request-item-response.dto.js';
import { RequestStatus } from '../enums/request-status.enum.js';
import { Priority } from '../enums/priority.enum.js';

export class RequestResponseDto {
  @Expose()
  id: string;

  @Expose()
  code: string;

  @Expose()
  requesterId: string;

  @Expose()
  status: RequestStatus;

  @Expose()
  priority: Priority;

  @Expose()
  neededBy: Date;

  @Expose()
  notes: string | null;

  @Expose()
  submittedAt: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  items: RequestItemResponseDto[];
}