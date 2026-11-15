import {Body,Controller,Get,Headers,Param,ParseUUIDPipe,Post,Query,Req,Res,UseGuards} from '@nestjs/common';
import type {Response} from 'express';
import {ApiError} from '../api-error.js';
import {AuthService} from '../auth/auth.service.js';
import {AuthGuard,Roles,WebOnly,type AuthRequest} from '../auth/guards.js';
import {RunPageQuery} from '../missions/dto.js';
import {RewardAccess} from './access.js';
import {SettlementService} from './settlement.service.js';
import {RewardNotificationService} from './notification.service.js';
import {CouponService} from './coupon.service.js';
import {PrepareSettlementDto,RewardBatchDto,CouponHoldDto,CouponActionDto} from './dto.js';
function noQuery(q:Record<string,unknown>){if(Object.keys(q).length)throw new ApiError(400,'INVALID_REQUEST');}
function reply(r:{body:unknown;replayed:boolean},res:Response){if(r.replayed)res.setHeader('Idempotency-Replayed','true');return r.body;}
@Controller('admin') @UseGuards(AuthGuard) @Roles('ADMIN') @WebOnly()
export class RewardAdminController {
 constructor(private readonly settlements:SettlementService,private readonly notices:RewardNotificationService,private readonly access:RewardAccess,private readonly auth:AuthService){}
 private async rate(r:AuthRequest){this.access.enabled();await this.auth.rate('reward-admin',r.principal.userId,100);}
 @Post('reward-settlements')
 async prepare(@Req()r:AuthRequest,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:PrepareSettlementDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r);return reply(await this.settlements.prepare(r.principal,key,dto),res);}
 @Get('reward-settlements/:settlementId')
 async get(@Req()r:AuthRequest,@Param('settlementId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>){noQuery(q);await this.rate(r);return this.settlements.get(r.principal,id);}
 @Post('reward-settlements/:settlementId/process')
 async process(@Req()r:AuthRequest,@Param('settlementId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:RewardBatchDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r);return reply(await this.settlements.process(r.principal,id,key,dto),res);}
 @Post('reward-notifications/dispatch')
 async dispatch(@Req()r:AuthRequest,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:RewardBatchDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r);return reply(await this.notices.dispatch(r.principal,key,dto),res);}
}
@Controller() @UseGuards(AuthGuard)
export class CouponController {
 constructor(private readonly coupons:CouponService,private readonly notices:RewardNotificationService,private readonly access:RewardAccess,private readonly auth:AuthService){}
 private async rate(r:AuthRequest,write=false){this.access.enabled();await this.auth.rate('coupons-'+(write?'write':'read'),r.principal.userId,write?100:300);}
 @Get('coupons/me')
 async mine(@Req()r:AuthRequest,@Query()q:RunPageQuery){await this.rate(r);return this.coupons.mine(r.principal,q);}
 @Get('reward-notifications/me')
 async notifications(@Req()r:AuthRequest,@Query()q:RunPageQuery){await this.rate(r);return this.notices.mine(r.principal,q);}
 @Get('coupons/:couponId')
 async get(@Req()r:AuthRequest,@Param('couponId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>){noQuery(q);await this.rate(r);return this.coupons.get(r.principal,id);}
 @Post('coupons/:couponId/holds')
 async hold(@Req()r:AuthRequest,@Param('couponId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:CouponHoldDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r,true);return reply(await this.coupons.hold(r.principal,id,key,dto),res);}
 @Post('coupons/:couponId/claims/:claimId/consume')
 async consume(@Req()r:AuthRequest,@Param('couponId',new ParseUUIDPipe())id:string,@Param('claimId',new ParseUUIDPipe())claim:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:CouponActionDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r,true);return reply(await this.coupons.consume(r.principal,id,claim,key,dto),res);}
 @Post('coupons/:couponId/claims/:claimId/release')
 async release(@Req()r:AuthRequest,@Param('couponId',new ParseUUIDPipe())id:string,@Param('claimId',new ParseUUIDPipe())claim:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:CouponActionDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r,true);return reply(await this.coupons.release(r.principal,id,claim,key,dto),res);}
 @Post('coupons/:couponId/cancel')
 async cancel(@Req()r:AuthRequest,@Param('couponId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:CouponActionDto,@Res({passthrough:true})res:Response){noQuery(q);await this.rate(r,true);return reply(await this.coupons.cancel(r.principal,id,key,dto),res);}
}
