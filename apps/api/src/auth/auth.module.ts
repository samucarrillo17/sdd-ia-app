import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';
import { User } from '../users/user.entity.js';
import { Session } from './session.entity.js';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Session]),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        limit: 10,
        ttl: 60000,
      },
    ]),
    ConfigModule,
    AuditModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService],
  exports: [AuthService, SessionService],
})
export class AuthModule {}