import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { IdempotencyService } from './idempotency.service.js';
import { Request } from 'express';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyService: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();

    // Solo aplicar a POST /requests/:id/reserve
    const isReserveEndpoint = request.method === 'POST' && 
      /^\/api\/requests\/[^/]+\/reserve$/.test(request.path);

    if (!isReserveEndpoint) {
      return next.handle();
    }

    // Extraer Idempotency-Key
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;

    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'Cabecera Idempotency-Key es obligatoria para esta operación',
      });
    }

    // Validar formato UUID (opcional pero recomendado)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_INVALID_FORMAT',
        message: 'Idempotency-Key debe ser un UUID válido',
      });
    }

    // Guardar en request para usar en el servicio
    (request as any).idempotencyKey = idempotencyKey;

    return next.handle();
  }
}