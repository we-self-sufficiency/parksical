import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../api-error.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthGuard, type AuthRequest } from '../auth/guards.js';
import { RankingConsentDto, RankingMonthQuery, RankingPageQuery, RankingQuery, RankingRecordMutationDto } from './dto.js';
import { RankingService } from './ranking.service.js';

@Controller() @UseGuards(AuthGuard)
export class RankingController {
  constructor(private readonly rankings: RankingService, private readonly auth: AuthService) {}
  private async rate(r: AuthRequest, write = false) { this.rankings.enabled(); await this.auth.rate('ranking-' + (write ? 'write' : 'read'), r.principal.userId, write ? 100 : 300); }
  private noQuery(q: Record<string, unknown>) { if (Object.keys(q).length) throw new ApiError(400, 'INVALID_REQUEST'); }
  @Get('rankings/:lotId/cohorts')
  async cohorts(@Req() r: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Query() q: RankingMonthQuery) { await this.rate(r); return this.rankings.cohorts(r.principal, id, q.month); }
  @Get('rankings/:lotId/me')
  async me(@Req() r: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Query() q: RankingQuery) { await this.rate(r); return this.rankings.me(r.principal, id, q); }
  @Get('rankings/:lotId')
  async list(@Req() r: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Query() q: RankingPageQuery) { await this.rate(r); return this.rankings.board(r.principal, id, q); }
  @Get('me/ranking-consent')
  async consent(@Req() r: AuthRequest, @Query() q: Record<string, unknown>) { this.noQuery(q); await this.rate(r); return this.rankings.consent(r.principal); }
  @Put('me/ranking-consent')
  async consentWrite(@Req() r: AuthRequest, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: RankingConsentDto, @Res({ passthrough: true }) res: Response) {
    this.noQuery(q); await this.rate(r, true); const result = await this.rankings.setConsent(r.principal, key, dto); if (result.replayed) res.setHeader('Idempotency-Replayed', 'true'); return result.body;
  }
  @Get('ranking-records/:runId')
  async record(@Req() r: AuthRequest, @Param('runId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>) { this.noQuery(q); await this.rate(r); return this.rankings.record(r.principal, id); }
  @Post('ranking-records/:runId/invalidation')
  async invalidate(@Req() r: AuthRequest, @Param('runId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: RankingRecordMutationDto, @Res({ passthrough: true }) res: Response) {
    this.noQuery(q); await this.rate(r, true); const result = await this.rankings.changeRecord(r.principal, id, 'INVALIDATE', key, dto); if (result.replayed) res.setHeader('Idempotency-Replayed', 'true'); return result.body;
  }
  @Post('ranking-records/:runId/deletion')
  async remove(@Req() r: AuthRequest, @Param('runId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: RankingRecordMutationDto, @Res({ passthrough: true }) res: Response) {
    this.noQuery(q); await this.rate(r, true); const result = await this.rankings.changeRecord(r.principal, id, 'DELETE', key, dto); if (result.replayed) res.setHeader('Idempotency-Replayed', 'true'); return result.body;
  }
}
