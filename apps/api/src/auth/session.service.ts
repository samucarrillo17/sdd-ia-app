import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, EntityManager } from 'typeorm';
import * as crypto from 'crypto';
import { Session } from './session.entity.js';
import { User } from '../users/user.entity.js';
import { ConfigService } from '@nestjs/config';

export interface ValidatedSession {
  id: string;
  userId: string;
  organizationId: string;
  role: string;
}

@Injectable()
export class SessionService {
  private readonly ttlHours: number;

  constructor(
    @InjectRepository(Session)
    private readonly sessionRepository: Repository<Session>,
    private readonly configService: ConfigService,
  ) {
    this.ttlHours = this.configService.get<number>('SESSION_TTL_HOURS') ?? 8;
  }

  generateToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async createSession(user: User, token: string, manager?: EntityManager): Promise<Session> {
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.ttlHours);

    const sessionRepo = manager ? manager.getRepository(Session) : this.sessionRepository;

    const session = sessionRepo.create({
      userId: user.id,
      organizationId: user.organizationId,
      tokenHash,
      expiresAt,
    });

    return sessionRepo.save(session);
  }

  async validateSession(sessionId: string): Promise<ValidatedSession | null> {
    const tokenHash = this.hashToken(sessionId);
    const session = await this.sessionRepository.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!session) {
      return null;
    }

    if (session.revokedAt) {
      return null;
    }

    if (session.expiresAt < new Date()) {
      return null;
    }

    if (!session.user || !session.user.isActive) {
      return null;
    }

    return {
      id: session.id,
      userId: session.userId,
      organizationId: session.organizationId,
      role: session.user.role,
    };
  }

  async revokeSession(sessionId: string, manager?: EntityManager): Promise<void> {
    const tokenHash = this.hashToken(sessionId);
    const sessionRepo = manager ? manager.getRepository(Session) : this.sessionRepository;
    await sessionRepo.update(
      { tokenHash },
      { revokedAt: new Date() },
    );
  }

  async revokeAllUserSessions(userId: string): Promise<void> {
    await this.sessionRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  getTtlMs(): number {
    return this.ttlHours * 60 * 60 * 1000;
  }

  getTtlHours(): number {
    return this.ttlHours;
  }
}