import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../api-error.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthGuard, Roles, WebOnly, type AuthRequest } from '../auth/guards.js';
import { RunPageQuery } from '../missions/dto.js';
import { ReservationCancelDto, ReservationHoldDto, ReservationPolicyWriteDto, ReservationQuoteDto, ReservationSandboxEventDto, ReservationSlotsQuery } from './dto.js';
import { ReservationService } from './reservation.service.js';

@Controller() @UseGuards(AuthGuard)
export class ReservationController {
  constructor(private readonly reservations: ReservationService, private readonly auth: AuthService) {}
  private async rate(r: AuthRequest, write = false) { this.reservations.enabled(); await this.auth.rate('reservations-' + (write ? 'write' : 'read'), r.principal.userId, write ? 100 : 300); }
  private noQuery(q: Record<string, unknown>) { if (Object.keys(q).length) throw new ApiError(400, 'INVALID_REQUEST'); }
  private reply(r: { body: unknown; replayed: boolean }, res: Response) { if (r.replayed) res.setHeader('Idempotency-Replayed', 'true'); return r.body; }
  @Get('lots/:lotId/reservation-policy')
  async policy(@Req() r: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>) { this.noQuery(q); await this.rate(r); return this.reservations.policy(r.principal, id); }
  @Put('admin/lots/:lotId/reservation-policy') @WebOnly() @Roles('ADMIN')
  async writePolicy(@Req() r: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: ReservationPolicyWriteDto, @Res({ passthrough: true }) res: Response) { this.noQuery(q); await this.rate(r, true); return this.reply(await this.reservations.writePolicy(r.principal, id, key, dto), res); }
  @Get('lots/:lotId/reservation-slots')
  async slots(@Req() r: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Query() q: ReservationSlotsQuery) { await this.rate(r); return this.reservations.slots(r.principal, id, q); }
  @Post('reservation-quotes')
  async quote(@Req() r: AuthRequest, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: ReservationQuoteDto, @Res({ passthrough: true }) res: Response) { this.noQuery(q); await this.rate(r, true); return this.reply(await this.reservations.quote(r.principal, key, dto), res); }
  @Post('reservations')
  async hold(@Req() r: AuthRequest, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: ReservationHoldDto, @Res({ passthrough: true }) res: Response) { this.noQuery(q); await this.rate(r, true); return this.reply(await this.reservations.hold(r.principal, key, dto), res); }
  @Get('reservations')
  async list(@Req() r: AuthRequest, @Query() q: RunPageQuery) { await this.rate(r); return this.reservations.list(r.principal, q); }
  @Get('reservations/:reservationId')
  async get(@Req() r: AuthRequest, @Param('reservationId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>) { this.noQuery(q); await this.rate(r); return this.reservations.get(r.principal, id); }
  @Post('reservations/:reservationId/cancel')
  async cancel(@Req() r: AuthRequest, @Param('reservationId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: ReservationCancelDto, @Res({ passthrough: true }) res: Response) { this.noQuery(q); await this.rate(r, true); return this.reply(await this.reservations.cancel(r.principal, id, key, dto), res); }
  @Post('reservations/:reservationId/sandbox-events')
  async event(@Req() r: AuthRequest, @Param('reservationId', new ParseUUIDPipe()) id: string, @Query() q: Record<string, unknown>, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: ReservationSandboxEventDto, @Res({ passthrough: true }) res: Response) { this.noQuery(q); await this.rate(r, true); return this.reply(await this.reservations.sandboxEvent(r.principal, id, key, dto), res); }
}
