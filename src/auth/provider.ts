import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { ApiError } from '../api-error.js';

export interface VerifiedIdentity { provider: string; subject: string; }
export interface LoginProvider { authenticate(subject: string, credential: string): Promise<VerifiedIdentity>; }
export const LOGIN_PROVIDER = Symbol('LOGIN_PROVIDER');

@Injectable()
export class DevelopmentLoginProvider implements LoginProvider {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}
  async authenticate(subject: string, credential: string): Promise<VerifiedIdentity> {
    if (this.config.nodeEnv === 'production' || !this.config.devAuthEnabled) throw new ApiError(403, 'PROVIDER_NOT_CONFIGURED');
    const digest = (x: string) => createHash('sha256').update(x).digest();
    if (!this.config.devAuthSecret || !timingSafeEqual(digest(credential), digest(this.config.devAuthSecret))) throw new ApiError(401, 'UNAUTHENTICATED');
    return { provider: 'DEV', subject };
  }
}
