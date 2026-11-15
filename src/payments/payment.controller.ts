import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request,Response } from 'express';
import { ApiError } from '../api-error.js';
import { AuthService } from '../auth/auth.service.js';
import { AuthGuard,type AuthRequest } from '../auth/guards.js';
import { RunPageQuery } from '../missions/dto.js';
import { PaymentAttemptDto,PaymentCancelDto,PaymentRecoverDto,PaymentOrderDto,PaymentQuoteDto,PaymentWebhookDto,ReservationPaymentOrderDto } from './dto.js';
import { PaymentService } from './payment.service.js';
@Controller() @UseGuards(AuthGuard)
export class PaymentController {
  constructor(private readonly payments:PaymentService,private readonly auth:AuthService){}
  private async rate(r:AuthRequest,write=false){this.payments.enabled();await this.auth.rate('payments-'+(write?'write':'read'),r.principal.userId,write?100:300);}
  private noQuery(q:Record<string,unknown>){if(Object.keys(q).length)throw new ApiError(400,'INVALID_REQUEST');}
  private reply(result:{body:unknown;replayed:boolean},res:Response){if(result.replayed)res.setHeader('Idempotency-Replayed','true');return result.body;}
  @Post('payment-quotes')
  async quote(@Req() r:AuthRequest,@Query() q:Record<string,unknown>,@Headers('Idempotency-Key') key:string|undefined,@Body() dto:PaymentQuoteDto,@Res({passthrough:true}) res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.payments.quote(r.principal,key,dto),res);}
  @Post('payments')
  async order(@Req() r:AuthRequest,@Query() q:Record<string,unknown>,@Headers('Idempotency-Key') key:string|undefined,@Body() dto:PaymentOrderDto,@Res({passthrough:true}) res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.payments.order(r.principal,key,dto.quoteId),res);}
  @Post('payments/reservations')
  async reservation(@Req() r:AuthRequest,@Query() q:Record<string,unknown>,@Headers('Idempotency-Key') key:string|undefined,@Body() dto:ReservationPaymentOrderDto,@Res({passthrough:true}) res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.payments.reservationOrder(r.principal,key,dto.reservationId),res);}
  @Get('payments')
  async list(@Req() r:AuthRequest,@Query() q:RunPageQuery){await this.rate(r);return this.payments.list(r.principal,q);}
  @Get('payments/:orderId')
  async get(@Req() r:AuthRequest,@Param('orderId',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.payments.get(r.principal,id);}
  @Get('payments/:orderId/receipt')
  async receipt(@Req() r:AuthRequest,@Param('orderId',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.payments.receipt(r.principal,id);}
  @Post('payments/:orderId/attempts')
  async attempt(@Req() r:AuthRequest,@Param('orderId',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>,@Headers('Idempotency-Key') key:string|undefined,@Body() dto:PaymentAttemptDto,@Res({passthrough:true}) res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.payments.attempt(r.principal,id,key,dto),res);}
  @Post('payments/:orderId/cancel')
  async cancel(@Req() r:AuthRequest,@Param('orderId',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>,@Headers('Idempotency-Key') key:string|undefined,@Body() dto:PaymentCancelDto,@Res({passthrough:true}) res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.payments.cancel(r.principal,id,key,dto),res);}
  @Post('payments/:orderId/reconcile')
  async recover(@Req() r:AuthRequest,@Param('orderId',new ParseUUIDPipe()) id:string,@Query() q:Record<string,unknown>,@Headers('Idempotency-Key') key:string|undefined,@Body() dto:PaymentRecoverDto,@Res({passthrough:true}) res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.payments.recover(r.principal,id,key),res);}
}
@Controller('payments/webhooks')
export class PaymentWebhookController {
  constructor(private readonly payments:PaymentService){}
  @Post('sandbox')
  async webhook(@Req() r:Request & {rawBody?:Buffer},@Query() q:Record<string,unknown>,@Headers('X-Payment-Timestamp') timestamp:string|undefined,@Headers('X-Payment-Signature') signature:string|undefined,@Body() dto:PaymentWebhookDto){
    if(Object.keys(q).length || !r.rawBody)throw new ApiError(400,'INVALID_REQUEST');
    return this.payments.webhook(r.rawBody,timestamp,signature,dto);
  }
}
