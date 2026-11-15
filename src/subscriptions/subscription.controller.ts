import {Body,Controller,Get,Headers,Param,ParseUUIDPipe,Post,Query,Req,Res,UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {ApiError} from '../api-error.js';
import {AuthGuard,type AuthRequest} from '../auth/guards.js';
import {AuthService} from '../auth/auth.service.js';
import {RunPageQuery} from '../missions/dto.js';
import {SubscriptionService} from './subscription.service.js';
import {SubscribeDto,RenewSubscriptionDto,CancelSubscriptionDto} from './dto.js';
@Controller() @UseGuards(AuthGuard)
export class SubscriptionController {
  constructor(private readonly subscriptions:SubscriptionService,private readonly auth:AuthService){}
  private async rate(r:AuthRequest,write=false){this.subscriptions.enabled();await this.auth.rate('subscriptions-'+(write?'write':'read'),r.principal.userId,write?100:300);}
  private noQuery(q:Record<string,unknown>){if(Object.keys(q).length)throw new ApiError(400,'INVALID_REQUEST');}
  private reply(result:{body:unknown;replayed:boolean},res:Response){if(result.replayed)res.setHeader('Idempotency-Replayed','true');return result.body;}
  @Get('subscriptions/products')
  async products(@Req()r:AuthRequest,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.subscriptions.products(r.principal);}
  @Post('subscriptions')
  async subscribe(@Req()r:AuthRequest,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:SubscribeDto,@Res({passthrough:true})res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.subscriptions.subscribe(r.principal,key,dto),res);}
  @Get('subscriptions/me')
  async me(@Req()r:AuthRequest,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.subscriptions.me(r.principal);}
  @Get('subscriptions/:subscriptionId')
  async get(@Req()r:AuthRequest,@Param('subscriptionId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.subscriptions.get(r.principal,id);}
  @Post('subscriptions/:subscriptionId/renewals')
  async renew(@Req()r:AuthRequest,@Param('subscriptionId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:RenewSubscriptionDto,@Res({passthrough:true})res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.subscriptions.renew(r.principal,id,key,dto),res);}
  @Post('subscriptions/:subscriptionId/cancel')
  async cancel(@Req()r:AuthRequest,@Param('subscriptionId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:CancelSubscriptionDto,@Res({passthrough:true})res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.subscriptions.cancel(r.principal,id,key,dto),res);}
  @Get('subscriptions/:subscriptionId/history')
  async history(@Req()r:AuthRequest,@Param('subscriptionId',new ParseUUIDPipe())id:string,@Query()q:RunPageQuery){await this.rate(r);return this.subscriptions.history(r.principal,id,q);}
  @Get('me/entitlements')
  async entitlements(@Req()r:AuthRequest,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.subscriptions.entitlements(r.principal);}
}
