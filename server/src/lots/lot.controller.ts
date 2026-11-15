import { Body, Controller, Get, Headers, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, Roles, WebOnly, type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { LotCreateDto, LotListQuery, LotReplaceDto } from './dto.js';
import { LotService } from './lot.service.js';

@Controller('admin/lots') @UseGuards(AuthGuard) @Roles('ADMIN') @WebOnly()
export class LotController {
  constructor(private readonly lots: LotService, private readonly auth: AuthService) {}
  @Get()
  list(@Req() req: AuthRequest, @Query() query: LotListQuery, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store'); return this.lots.list(req.principal, query.after);
  }
  @Get(':lotId')
  get(@Req() req: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store'); return this.lots.get(req.principal, id);
  }
  @Get(':lotId/revisions/:version')
  revision(@Req() req: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Param('version', new ParseIntPipe()) version: number, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store'); return this.lots.get(req.principal, id, version);
  }
  @Post()
  async create(@Req() req: AuthRequest, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: LotCreateDto, @Res({ passthrough: true }) res: Response) {
    await this.auth.rate('lot-write', req.principal.sessionId, 100);
    res.setHeader('Cache-Control', 'no-store'); const result = await this.lots.save(req.principal, key, dto);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true'); return result.body;
  }
  @Put(':lotId')
  async replace(@Req() req: AuthRequest, @Param('lotId', new ParseUUIDPipe()) id: string, @Headers('Idempotency-Key') key: string | undefined, @Body() dto: LotReplaceDto, @Res({ passthrough: true }) res: Response) {
    await this.auth.rate('lot-write', req.principal.sessionId, 100);
    res.setHeader('Cache-Control', 'no-store'); const result = await this.lots.save(req.principal, key, dto, id);
    if (result.replayed) res.setHeader('Idempotency-Replayed', 'true'); return result.body;
  }
}
