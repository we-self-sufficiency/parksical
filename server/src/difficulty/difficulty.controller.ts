import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { DifficultyQueryDto } from './dto.js';
import { DifficultyService } from './difficulty.service.js';

@Controller('lots') @UseGuards(AuthGuard)
export class DifficultyController {
  constructor(private readonly difficulty: DifficultyService, private readonly auth: AuthService) {}
  @Get(':lotId/difficulty')
  async get(@Req() req: AuthRequest, @Param('lotId',new ParseUUIDPipe()) id: string, @Query() query: DifficultyQueryDto, @Res({passthrough:true}) response: Response) {
    response.setHeader('Cache-Control','no-store');
    await this.auth.rate('difficulty-read',req.principal.sessionId,300);
    return this.difficulty.get(id,query,new Date().getUTCFullYear());
  }
}
