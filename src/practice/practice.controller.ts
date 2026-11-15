import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../api-error.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthGuard, type AuthRequest } from '../auth/guards.js';
import { RunPageQuery } from '../missions/dto.js';
import { PracticeInvalidateDto, PracticeProgressQuery } from './dto.js';
import { PracticeService } from './practice.service.js';

@Controller('practice') @UseGuards(AuthGuard)
export class PracticeController {
  constructor(private readonly practice: PracticeService, private readonly auth: AuthService) {}
  private async rate(r: AuthRequest, write = false) { this.practice.enabled(); await this.auth.rate('practice-' + (write ? 'write' : 'read'), r.principal.userId, write ? 100 : 300); }
  private noQuery(q: Record<string, unknown>) { if (Object.keys(q).length) throw new ApiError(400, 'INVALID_REQUEST'); }
  @Get('runs')
  async list(@Req() r: AuthRequest, @Query() q: RunPageQuery) { await this.rate(r); return this.practice.list(r.principal, q); }
  @Get('runs/:runId')
  async get(@Req() r: AuthRequest, @Param('runId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>) { this.noQuery(q); await this.rate(r); return this.practice.get(r.principal, id); }
  @Get('progress')
  async progress(@Req() r: AuthRequest, @Query() q: PracticeProgressQuery) { await this.rate(r); return this.practice.progress(r.principal, q.runId); }
  @Get('awards')
  async awards(@Req() r: AuthRequest, @Query() q: RunPageQuery) { await this.rate(r); return this.practice.awards(r.principal, q); }
  @Post('runs/:runId/invalidation')
  async invalidate(@Req() r: AuthRequest, @Param('runId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: PracticeInvalidateDto, @Res({ passthrough: true }) res: Response) {
    this.noQuery(q); await this.rate(r, true);
    const result = await this.practice.invalidate(r.principal, id, key, dto);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}
