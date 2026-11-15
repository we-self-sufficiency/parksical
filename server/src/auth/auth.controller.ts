import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { AuthGuard, Roles, WebOnly, type AuthRequest } from './guards.js';
import { DevelopmentLoginDto, PairingApproveDto, PairingExchangeDto, PairingStartDto, RefreshDto } from './dto.js';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  private actor(req: Request) { return req.socket.remoteAddress ?? 'unknown'; }

  @Post('auth/development/login') @HttpCode(200)
  async login(@Body() dto: DevelopmentLoginDto, @Headers('X-Development-Key') key: string | undefined, @Req() req: Request) {
    await this.auth.rate('login', this.actor(req), 20);
    return this.auth.login(dto.subject, key ?? '');
  }

  @Post('auth/refresh') @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    await this.auth.rate('refresh', this.actor(req), 100);
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('auth/logout') @HttpCode(204) @UseGuards(AuthGuard)
  async logout(@Req() req: AuthRequest) { await this.auth.revoke(req.principal, req.principal.sessionId); }

  @Get('me') @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest) { return this.auth.me(req.principal); }

  @Get('auth/sessions') @WebOnly() @UseGuards(AuthGuard)
  sessions(@Req() req: AuthRequest) { return this.auth.sessions(req.principal); }

  @Delete('auth/sessions/:sessionId') @HttpCode(204) @WebOnly() @UseGuards(AuthGuard)
  async revoke(@Req() req: AuthRequest, @Param('sessionId', new ParseUUIDPipe()) id: string) { await this.auth.revoke(req.principal, id); }

  @Post('auth/vehicle-links')
  async startPairing(@Body() dto: PairingStartDto, @Req() req: Request) {
    await this.auth.rate('pairing-start', this.actor(req), 20);
    return this.auth.startPairing(dto.installationId, dto.installationSecret);
  }

  @Post('auth/vehicle-links/approve') @HttpCode(200) @WebOnly() @UseGuards(AuthGuard)
  async approve(@Req() req: AuthRequest, @Body() dto: PairingApproveDto) {
    await this.auth.rate('pairing-approve', req.principal.userId, 20);
    return this.auth.approve(req.principal, dto.userCode);
  }

  @Post('auth/vehicle-links/exchange') @HttpCode(200)
  async exchange(@Body() dto: PairingExchangeDto, @Req() req: Request) {
    await this.auth.rate('pairing-exchange', this.actor(req), 100);
    return this.auth.exchange(dto.deviceCode);
  }

  @Get('auth/vehicle-links') @WebOnly() @UseGuards(AuthGuard)
  links(@Req() req: AuthRequest) { return this.auth.links(req.principal); }

  @Delete('auth/vehicle-links/:installationId') @HttpCode(204) @WebOnly() @UseGuards(AuthGuard)
  async unlink(@Req() req: AuthRequest, @Param('installationId', new ParseUUIDPipe()) id: string) { await this.auth.unlink(req.principal, id); }

  @Delete('auth/admin/sessions/:sessionId') @HttpCode(204) @WebOnly() @Roles('ADMIN') @UseGuards(AuthGuard)
  async adminRevoke(@Req() req: AuthRequest, @Param('sessionId', new ParseUUIDPipe()) id: string) { await this.auth.adminRevoke(req.principal, id); }
}
