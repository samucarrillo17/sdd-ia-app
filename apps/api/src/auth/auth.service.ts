import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import { User } from '../users/user.entity.js';
import { SessionService } from './session.service.js';
import { LoginDto } from './dto/login.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditAction, AuditEntityType } from '../audit/audit-log.entity.js';

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  role: string;
  organization: {
    id: string;
    code: string;
    name: string;
  };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly sessionService: SessionService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async login(loginDto: LoginDto, ip?: string): Promise<{ user: UserResponse; token: string }> {
    // Buscar usuarios por email (puede haber múltiples en distintas organizaciones)
    const users = await this.userRepository.find({
      where: { email: loginDto.email },
      relations: { organization: true },
    });

    // Si no hay usuarios o hay múltiples con el mismo email en distintas orgs,
    // devolvemos error genérico para no filtrar información
    if (users.length !== 1) {
      // Aun así verificamos hash contra un valor ficticio para timing attack protection
      const fakeHash = '$argon2id$v=19$m=65536,t=3,p=4$fake$fake';
      await argon2.verify(fakeHash, loginDto.password);
      
      // Auditar login fallido
      await this.auditLoginFailed(loginDto.email, ip);
      
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Credenciales inválidas',
      });
    }

    const user = users[0];

    const isValid = await argon2.verify(user.passwordHash, loginDto.password);

    if (!isValid || !user.isActive) {
      // Auditar login fallido
      await this.auditLoginFailed(loginDto.email, ip);
      
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_CREDENTIALS',
        message: 'Credenciales inválidas',
      });
    }

    const token = this.sessionService.generateToken();

    // Crear sesión y auditar login exitoso en la misma transacción
    await this.dataSource.transaction(async (manager) => {
      await this.sessionService.createSession(user, token, manager);

      await this.auditService.record(manager, {
        organizationId: user.organizationId,
        actorUserId: user.id,
        entityType: AuditEntityType.SESSION,
        entityId: user.id,
        action: AuditAction.LOGIN,
        after: {
          userId: user.id,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        },
        ip: ip ?? null,
      });
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        organization: {
          id: user.organization.id,
          code: user.organization.code,
          name: user.organization.name,
        },
      },
      token,
    };
  }

  private async auditLoginFailed(email: string, ip?: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.auditService.record(manager, {
        organizationId: 'unknown', // No sabemos la org en login fallido
        actorUserId: null,
        entityType: AuditEntityType.SESSION,
        entityId: 'unknown',
        action: AuditAction.LOGIN_FAILED,
        after: { email },
        ip: ip ?? null,
      });
    });
  }

  async logout(sessionId: string, user: UserResponse): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.sessionService.revokeSession(sessionId, manager);
      
      await this.auditService.record(manager, {
        organizationId: user.organization.id,
        actorUserId: user.id,
        entityType: AuditEntityType.SESSION,
        entityId: sessionId,
        action: AuditAction.LOGOUT,
        before: { sessionId },
        ip: null,
      });
    });
  }

  async getMe(userId: string): Promise<UserResponse | null> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { organization: true },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      organization: {
        id: user.organization.id,
        code: user.organization.code,
        name: user.organization.name,
      },
    };
  }
}