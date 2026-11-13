import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, VehicleOnly, type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { VehicleService } from './vehicle.service.js';
import { VehicleEventDto, VehicleSessionDto } from './dto.js';

@Controller('vehicle-sessions') @VehicleOnly() @UseGuards(AuthGuard)
export class VehicleController {
  constructor(private readonly vehicle: VehicleService, private readonly auth: AuthService) {}

  @Post()
  async create(@Req() req: AuthRequest, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: VehicleSessionDto, @Res({ passthrough: true }) response: Response) {
    await this.auth.rate('vehicle-create', req.principal.sessionId, 60);
    const result = await this.vehicle.create(req.principal, key, dto);
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }

  @Get(':sessionId')
  get(@Req() req: AuthRequest, @Param('sessionId', new ParseUUIDPipe()) id: string) { return this.vehicle.get(req.principal, id); }

  @Post(':sessionId/events')
  async event(@Req() req: AuthRequest, @Param('sessionId', new ParseUUIDPipe()) id: string, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: VehicleEventDto, @Res({ passthrough: true }) response: Response) {
    await this.auth.rate('vehicle-event', req.principal.sessionId, 1000);
    const result = await this.vehicle.event(req.principal, id, key, dto);
    if (result.replayed) response.setHeader('Idempotency-Replayed', 'true');
    return result.body;
  }
}
