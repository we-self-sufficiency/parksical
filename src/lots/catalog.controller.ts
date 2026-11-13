import { Controller, Get, Param, ParseUUIDPipe, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { LotDetailQuery, LotSearchQuery } from './search.dto.js';
import { CatalogService } from './catalog.service.js';

@Controller('lots') @UseGuards(AuthGuard)
export class CatalogController {
  constructor(private readonly catalog:CatalogService,private readonly auth:AuthService){}
  @Get()
  async search(@Req() req:AuthRequest,@Query() query:LotSearchQuery,@Res({passthrough:true}) res:Response) {
    res.setHeader('Cache-Control','no-store');await this.auth.rate('catalog-read',req.principal.sessionId,300);
    return this.catalog.search(query,new Date().getUTCFullYear());
  }
  @Get(':lotId')
  async detail(@Req() req:AuthRequest,@Param('lotId',new ParseUUIDPipe()) id:string,@Query() query:LotDetailQuery,@Res({passthrough:true}) res:Response) {
    res.setHeader('Cache-Control','no-store');await this.auth.rate('catalog-read',req.principal.sessionId,300);
    return this.catalog.detail(id,query,new Date().getUTCFullYear());
  }
}
