import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { SessionService } from '../../auth/session.service.js';

export interface AuthenticatedUser {
  id: string;
  organizationId: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const sessionId = request.cookies?.sid;

    if (!sessionId) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'UNAUTHORIZED',
        message: 'No autenticado',
      });
    }

    const session = await this.sessionService.validateSession(sessionId);

    if (!session) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'SESSION_INVALID',
        message: 'Sesión inválida o expirada',
      });
    }

    request.user = {
      id: session.userId,
      organizationId: session.organizationId,
      role: session.role,
    };

    return true;
  }
}