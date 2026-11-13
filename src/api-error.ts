import { HttpException } from '@nestjs/common';

// Codes come only from server code, never from an external exception or request body.
export class ApiError extends HttpException {
  constructor(status: number, readonly code: string, readonly retryAfter?: number) { super(code, status); }
}
