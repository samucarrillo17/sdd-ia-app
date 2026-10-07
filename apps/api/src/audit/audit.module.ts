import { Module } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity.js';
import { AuditService } from './audit.service.js';
import { AuditController } from './audit.controller.js';

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    {
      provide: 'AUDIT_LOG_REPOSITORY',
      useFactory: (dataSource: DataSource) => dataSource.getRepository(AuditLog),
      inject: [DataSource],
    },
  ],
  exports: [AuditService, 'AUDIT_LOG_REPOSITORY'],
})
export class AuditModule {}