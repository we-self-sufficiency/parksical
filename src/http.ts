import { randomUUID } from 'node:crypto';
import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './api-error.js';

export type LogSink = (record: Record<string, string | number>) => void;
export const defaultLogSink: LogSink = record => { console.log(JSON.stringify(record)); };

export function requestContext(sink: LogSink) {
  return (request: Request, response: Response, next: NextFunction) => {
    const incoming = request.get('X-Request-Id');
    const requestId = incoming && /^[A-Za-z0-9_.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    response.locals.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    if (request.path.startsWith('/api/v1/auth/') || request.path.startsWith('/api/v1/vehicle-sessions') || request.path.startsWith('/api/v1/admin/') || (request.path === '/api/v1/lots' || request.path.startsWith('/api/v1/lots/')) || request.path.startsWith('/api/v1/reviews') || request.path === '/api/v1/me') response.setHeader('Cache-Control', 'no-store');
    const start = performance.now();
    response.on('finish', () => {
      // Allowlisted only: no URL/path (QR tokens), query, headers, body, error message or stack.
      sink({ event: 'http_request', requestId, method: request.method, status: response.statusCode, durationMs: Math.round(performance.now() - start) });
    });
    next();
  };
}

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = error instanceof HttpException ? error.getStatus() :
      typeof error === 'object' && error !== null && 'status' in error &&
      (error.status === 400 || error.status === 413) ? error.status : 500;
    const codes: Record<number, string> = { 400: 'INVALID_REQUEST', 401: 'UNAUTHENTICATED', 403: 'FORBIDDEN', 404: 'RESOURCE_NOT_FOUND', 409: 'CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 422: 'INVALID_INPUT', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE' };
    const code = error instanceof ApiError ? error.code : codes[status] ?? 'INTERNAL_ERROR';
    if (error instanceof ApiError && error.retryAfter) response.setHeader('Retry-After', error.retryAfter);
    response.status(status).json({ error: {
      code, message: code, requestId: response.locals.requestId as string,
      retryable: status === 429 || status === 503,
      details: [],
    } });
  }
}
