import { Injectable, SetMetadata, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from '../api-error.js';
import { AuthService, type Principal } from './auth.service.js';

export interface AuthRequest extends Request { principal: Principal; }
export const WebOnly = () => SetMetadata('auth.webOnly', true);
export const Roles = (...roles: ('USER' | 'ADMIN')[]) => SetMetadata('auth.roles', roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.get('Authorization');
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'UNAUTHENTICATED');
    request.principal = await this.auth.authenticate(header.slice(7));
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('auth.webOnly', targets) && request.principal.kind !== 'WEB') throw new ApiError(403, 'WEB_SESSION_REQUIRED');
    const roles = this.reflector.getAllAndOverride<string[]>('auth.roles', targets);
    if (roles && !roles.includes(request.principal.role)) throw new ApiError(403, 'FORBIDDEN');
    return true;
  }
}
