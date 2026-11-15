import { Body,Controller,Delete,Get,Headers,HttpCode,Param,ParseUUIDPipe,Post,Query,Req,Res,UseGuards } from '@nestjs/common';
import type { Request,Response } from 'express';
import { AuthGuard,type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { ApiError } from '../api-error.js';
import { QrService } from './qr.service.js';
import { QrExchangeDto,QrIssueDto } from './dto.js';
import { checkCsrf,cookie,cookieNames,csrf,sameOrigin,secret,setCookie,validSecret } from './security.js';
function empty(value:Record<string,unknown>){if(Object.keys(value).length)throw new ApiError(400,'INVALID_REQUEST');}
@Controller('parked-locations/:locationId/qr-tokens') @UseGuards(AuthGuard)
export class QrOwnerController {
  constructor(private readonly qr:QrService,private readonly auth:AuthService){}
  @Post()
  async issue(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:QrIssueDto){
    this.qr.origin();await this.auth.rate('qr-owner-write',req.principal.userId,60);return this.qr.issue(req.principal,id,dto.expectedVersion,key);
  }
  @Delete(':grantId')
  async revoke(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Param('grantId',new ParseUUIDPipe())grantId:string,@Headers('Idempotency-Key')key:string|undefined,@Body()body:Record<string,unknown>){
    empty(body);this.qr.origin();await this.auth.rate('qr-owner-write',req.principal.userId,60);return this.qr.revoke(req.principal,id,grantId,key);
  }
}
@Controller('qr')
export class QrPhoneController {
  constructor(private readonly qr:QrService,private readonly auth:AuthService){}
  private async rate(req:Request){await this.auth.rate('qr-public',req.socket.remoteAddress??'unknown',300);}
  @Post('bootstrap') @HttpCode(200)
  async bootstrap(@Req()req:Request,@Body()body:Record<string,unknown>,@Res({passthrough:true})res:Response){
    empty(body);const origin=this.qr.origin();sameOrigin(req,origin);await this.rate(req);
    const names=cookieNames(origin),old=cookie(req,names.challenge),seed=validSecret(old)?old:secret();
    setCookie(res,origin,names.challenge,seed,10*60*1000);return {csrfToken:csrf(seed)};
  }
  @Post('exchanges') @HttpCode(200)
  async exchange(@Req()req:Request,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:QrExchangeDto,@Res({passthrough:true})res:Response){
    const origin=this.qr.origin(),seed=checkCsrf(req,origin);await this.rate(req);
    const result=await this.qr.exchange(dto.token,seed,key);
    setCookie(res,origin,cookieNames(origin).session,result.credential,result.expiresAt.getTime()-Date.now());
    if(result.replayed)res.setHeader('Idempotency-Replayed','true');
    return {expiresAt:result.expiresAt.toISOString(),viewPath:'/api/v1/qr/location'};
  }
  @Get('location')
  async location(@Req()req:Request,@Query()query:Record<string,unknown>){
    empty(query);const origin=this.qr.origin();sameOrigin(req,origin,false);await this.rate(req);
    return this.qr.location(cookie(req,cookieNames(origin).session));
  }
  @Post('logout') @HttpCode(204)
  async logout(@Req()req:Request,@Headers('Idempotency-Key')key:string|undefined,@Body()body:Record<string,unknown>,@Res({passthrough:true})res:Response){
    empty(body);if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');
    const origin=this.qr.origin();checkCsrf(req,origin);await this.rate(req);
    await this.qr.logout(cookie(req,cookieNames(origin).session));setCookie(res,origin,cookieNames(origin).session,'',0);
  }
}
