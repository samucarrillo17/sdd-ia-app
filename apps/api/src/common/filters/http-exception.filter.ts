import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

export interface ErrorResponse {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = 'Error interno del servidor';
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        code = (resp.code as string) || exception.name;
        message = (resp.message as string) || exception.message;
        details = resp.details;
      } else {
        message = exception.message;
        code = exception.name;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      code = exception.name;
    }

    this.logger.error(
      `${request.method} ${request.url} - ${statusCode} - ${code}: ${message}`,
      exception instanceof Error ? exception.stack : '',
    );

    const errorResponse: ErrorResponse = {
      statusCode,
      code,
      message,
      ...(details !== undefined && { details }),
    };

    response.status(statusCode).json(errorResponse);
  }
}