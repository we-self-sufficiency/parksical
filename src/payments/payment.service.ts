import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { AuthService, type Principal } from '../auth/auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DatabaseService } from '../database.service.js';
import type { Prisma, PaymentOrder } from '../generated/prisma/client.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { asJson } from '../lots/store.js';
import type { RunPageQuery } from '../missions/dto.js';
import { cursorLocation, locationCursor } from '../locations/pagination.js';
import { ReservationService } from '../reservations/reservation.service.js';
import { horizon, inHours, quoteGeneralFare, slotsBetween, HALF_HOUR_MS } from '../reservations/rules.js';
import { fingerprint } from '../vehicle/normalization.js';
import type { PaymentAttemptDto, PaymentQuoteDto, PaymentWebhookDto } from './dto.js';
import { PAYMENT_PROVIDER, type PaymentProvider, type ProviderPayment } from './provider.js';
import { SubscriptionClock } from '../subscriptions/clock.js';
import { projectSubscriptionPayment,subscriptionNeedsCompensation } from '../subscriptions/projection.js';

type Tx=Prisma.TransactionClient;
const include={attempt:true,refund:true,receipt:true} as const;
type FullOrder=Prisma.PaymentOrderGetPayload<{include:typeof include}>;
export const paymentBoundary={source:'SYNTHETIC',provider:'SANDBOX',operationalAllowed:false,realPaymentVerified:false,operationalBlockers:['D-05']} as const;
export function verifyPayment(order:Pick<PaymentOrder,'id'|'amountKrw'|'currency'>, result:ProviderPayment, transactionId?:string|null) {
  if(result.orderId!==order.id || result.amountKrw!==order.amountKrw || result.currency!==order.currency || (transactionId && result.transactionId!==transactionId) || !['SUCCEEDED','FAILED','REFUNDED'].includes(result.status))throw new ApiError(422,'PAYMENT_PROVIDER_MISMATCH');
}
@Injectable()
export class PaymentService {
  constructor(private readonly auth:AuthService,private readonly db:DatabaseService,private readonly reservations:ReservationService,@Inject(APP_CONFIG) private readonly config:AppConfig,@Inject(PAYMENT_PROVIDER) private readonly provider:PaymentProvider,private readonly subscriptionClock:SubscriptionClock){}
  enabled(){if(!this.config.devPaymentsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'PAYMENTS_POLICY_DISABLED');}
  private async external<T>(call:()=>Promise<T>):Promise<T>{try{return await call();}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(503,'PAYMENT_PROVIDER_UNAVAILABLE');}}
  private async lock(tx:Tx,userId:string){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'reservation-user:'+userId},0))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'payment-user:'+userId},0))`;
  }
  private async user<T>(p:Principal,work:(tx:Tx)=>Promise<T>){this.enabled();return this.auth.forUser(p,async tx=>{await this.lock(tx,p.userId);return work(tx);});}
  private async now(tx:Tx){const rows=await tx.$queryRaw<{ms:bigint}[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms`;return new Date(Number(rows[0]!.ms));}
  private async orderTime(tx:Tx,row:PaymentOrder){return row.subscriptionCycleId?this.subscriptionClock.now(tx):this.now(tx);}
  private async owned(tx:Tx,userId:string,id:string){const row=await tx.paymentOrder.findFirst({where:{id,userId},include});if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');return row;}
  private view(row:FullOrder){return {id:row.id,quoteId:row.quoteId,reservationId:row.reservationId,lotId:row.lotId,...(row.subscriptionCycleId?{subscriptionCycleId:row.subscriptionCycleId}:{}),amountKrw:row.amountKrw,currency:row.currency,pricing:row.pricing,state:row.state,attempt:row.attempt?{state:row.attempt.state,transactionId:row.attempt.transactionId}:null,refund:row.refund?{state:row.refund.state,amountKrw:row.refund.amountKrw}:null,receiptId:row.receipt?.id??null,createdAt:row.createdAt.toISOString(),expiresAt:row.expiresAt.toISOString(),...paymentBoundary};}
  private async command(tx:Tx,userId:string,key:string|undefined,route:string,dto:unknown){
    if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');
    const requestHash=fingerprint({route,dto}),where={userId_key:{userId,key}};
    const old=await tx.paymentMutation.findUnique({where});
    if(old){if(old.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return old;}
    if(!route.startsWith('cancel:') && !route.startsWith('recover:') && await tx.paymentMutation.count({where:{userId}})>=4000)throw new ApiError(409,'PAYMENT_COMMAND_LIMIT');
    return tx.paymentMutation.create({data:{userId,key,requestHash}});
  }
  private async finish(tx:Tx,userId:string,key:string,body:unknown){const response=asJson(body);await tx.paymentMutation.update({where:{userId_key:{userId,key}},data:{response}});return {body:response,replayed:false};}
  private async mutate(p:Principal,key:string|undefined,route:string,dto:unknown,work:(tx:Tx)=>Promise<unknown>){return this.user(p,async tx=>{const cmd=await this.command(tx,p.userId,key,route,dto);if(cmd.response)return {body:cmd.response,replayed:true};return this.finish(tx,p.userId,key!,await work(tx));});}
  private async venue(tx:Tx,lotId:string,structureVersion?:number){
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:'+lotId},0))`;
    const lot=await tx.parkingLot.findUnique({where:{id:lotId}});if(!lot)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const revision=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId,version:lot.currentVersion}}}),snapshot=revision.snapshot as unknown as LotSnapshotDto;
    if(!revision.active || revision.source!=='SYNTHETIC' || !snapshot.fees || snapshot.parkingType!=='SELF_PARK' || !snapshot.operatingHours?.length || (structureVersion!==undefined && lot.currentVersion!==structureVersion))throw new ApiError(409,'PAYMENT_VENUE_UNAVAILABLE');
    return {lot,snapshot};
  }
  async quote(p:Principal,key:string|undefined,dto:PaymentQuoteDto){return this.mutate(p,key,'quote',dto,async tx=>{
    const {lot,snapshot}=await this.venue(tx,dto.lotId),now=await this.now(tx),start=new Date(dto.startsAt),end=new Date(start.getTime()+dto.durationMinutes*60000);
    if(start<=now || end>horizon(now) || start.getTime()%HALF_HOUR_MS || dto.durationMinutes%30 || slotsBetween(start,end).some(s=>!inHours(s,snapshot.operatingHours)))throw new ApiError(422,'INVALID_PAYMENT_PERIOD');
    if(await tx.paymentQuote.count({where:{userId:p.userId}})>=1000)throw new ApiError(409,'PAYMENT_QUOTE_LIMIT');
    const fare=quoteGeneralFare(snapshot.fees!,start,end),amountKrw=fare.generalAmountKrw;
    if(amountKrw<1)throw new ApiError(422,'PAYMENT_ZERO_AMOUNT_UNSUPPORTED');
    const id=randomUUID(),expiresAt=new Date(Math.min(start.getTime(),now.getTime()+300000)),details={currency:'KRW',priceVersion:'prepayment-v1',amountKrw,days:fare.days,fees:snapshot.fees,structureVersion:lot.currentVersion,dailyCapScope:'GENERAL_FARE_PER_KST_DATE',capacityReserved:false};
    const body={quoteId:id,lotId:lot.id,startsAt:start.toISOString(),endsAt:end.toISOString(),createdAt:now.toISOString(),expiresAt:expiresAt.toISOString(),details,...paymentBoundary};
    await tx.paymentQuote.create({data:{id,userId:p.userId,lotId:lot.id,structureVersion:lot.currentVersion,startsAt:start,endsAt:end,amountKrw,details:asJson(details),createdAt:now,expiresAt,receipt:asJson(body)}});return body;
  });}
  private async create(tx:Tx,data:Pick<PaymentOrder,'userId'|'quoteId'|'reservationId'|'lotId'|'amountKrw'|'pricing'|'expiresAt'> & {subscriptionCycleId?:string},at?:Date){
    if(data.amountKrw<1)throw new ApiError(422,'PAYMENT_ZERO_AMOUNT_UNSUPPORTED');
    if(await tx.paymentOrder.count({where:{userId:data.userId}})>=1000)throw new ApiError(409,'PAYMENT_ORDER_LIMIT');
    const id=randomUUID(),createdAt=at??await this.now(tx),row={...data,subscriptionCycleId:data.subscriptionCycleId??null,id,currency:'KRW',state:'CREATED',createdAt,attempt:null,refund:null,receipt:null,creationReceipt:{}};
    const body=this.view(row);await tx.paymentOrder.create({data:{...data,pricing:asJson(data.pricing),id,currency:'KRW',state:'CREATED',createdAt,creationReceipt:asJson(body)}});return body;
  }
  async createSubscriptionOrder(tx:Tx,userId:string,cycleId:string,now:Date){
    this.enabled();if(!this.config.devSubscriptionsEnabled)throw new ApiError(403,'SUBSCRIPTIONS_POLICY_DISABLED');
    const c=await tx.subscriptionCycle.findFirstOrThrow({where:{id:cycleId,subscription:{userId}}});
    return this.create(tx,{userId,subscriptionCycleId:cycleId,quoteId:null,reservationId:null,lotId:null,amountKrw:c.amountKrw,pricing:c.pricing,expiresAt:c.chargeDeadline},now);
  }
  async cancelPendingSubscriptionOrders(tx:Tx,subscriptionId:string,now:Date){
    const rows=await tx.paymentOrder.findMany({where:{subscriptionCycle:{subscriptionId},state:{in:['CREATED','PENDING']}}});
    for(const row of rows){await tx.paymentOrder.update({where:{id:row.id},data:{state:'CANCELLED'}});await projectSubscriptionPayment(tx,row.subscriptionCycleId!,row.id,'CANCELLED',now);}
  }
  async order(p:Principal,key:string|undefined,quoteId:string){return this.mutate(p,key,'order',{quoteId},async tx=>{
    const q=await tx.paymentQuote.findFirst({where:{id:quoteId,userId:p.userId}});if(!q)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const old=await tx.paymentOrder.findUnique({where:{quoteId}});if(old)return old.creationReceipt;
    if(q.expiresAt<=await this.now(tx))throw new ApiError(409,'PAYMENT_QUOTE_EXPIRED');await this.venue(tx,q.lotId,q.structureVersion);
    return this.create(tx,{userId:p.userId,quoteId,reservationId:null,lotId:q.lotId,amountKrw:q.amountKrw,pricing:q.details,expiresAt:q.expiresAt});
  });}
  async reservationOrder(p:Principal,key:string|undefined,reservationId:string){return this.mutate(p,key,'reservation-order',{reservationId},async tx=>{
    const old=await tx.paymentOrder.findFirst({where:{reservationId,userId:p.userId}});if(old)return old.creationReceipt;
    const r=await this.reservations.bindPayment(tx,p.userId,reservationId);
    return this.create(tx,{userId:p.userId,quoteId:null,reservationId,lotId:r.lotId,amountKrw:r.quote.amountKrw,pricing:r.quote.details,expiresAt:r.holdExpiresAt});
  });}
  async get(p:Principal,id:string){return this.user(p,async tx=>this.view(await this.owned(tx,p.userId,id)));}
  async list(p:Principal,q:RunPageQuery){return this.user(p,async tx=>{
    const limit=q.limit??20,binding=p.userId+':payments',rows=await tx.paymentOrder.findMany({where:{userId:p.userId},include,orderBy:[{createdAt:'desc'},{id:'desc'}]});
    const cursor=q.cursor?cursorLocation(binding,limit,q.cursor):null,index=cursor?rows.findIndex(r=>r.id===cursor):-1;
    if(cursor && index<0)throw new ApiError(400,'INVALID_PAYMENT_CURSOR');const rest=rows.slice(index+1);
    return {items:rest.slice(0,limit).map(r=>this.view(r)),nextCursor:rest.length>limit?locationCursor(binding,limit,rest[limit-1]!.id):null};
  });}
  async receipt(p:Principal,id:string){return this.user(p,async tx=>{const row=await this.owned(tx,p.userId,id);if(!row.receipt)throw new ApiError(404,'PAYMENT_RECEIPT_NOT_FOUND');return {receipt:row.receipt.body,refund:row.refund?{state:row.refund.state,amountKrw:row.refund.amountKrw}:null,...paymentBoundary};});}
  async attempt(p:Principal,id:string,key:string|undefined,dto:PaymentAttemptDto){
    const stage=await this.user(p,async tx=>{
      const cmd=await this.command(tx,p.userId,key,'attempt:'+id,dto),row=await this.owned(tx,p.userId,id);
      if(cmd.response)return {response:cmd.response,row};
      if(row.attempt){if(row.attempt.sandboxOutcome!==dto.sandboxOutcome)throw new ApiError(409,'PAYMENT_ATTEMPT_CONFLICT');}
      else {
        if(row.state!=='CREATED' || row.expiresAt<=await this.orderTime(tx,row))throw new ApiError(409,'PAYMENT_ATTEMPT_CLOSED');
        if(row.subscriptionCycleId){if(!this.config.devSubscriptionsEnabled)throw new ApiError(403,'SUBSCRIPTIONS_POLICY_DISABLED');}
        else if(row.reservationId)await this.reservations.bindPayment(tx,p.userId,row.reservationId);
        else {const q=await tx.paymentQuote.findUniqueOrThrow({where:{id:row.quoteId!}});await this.venue(tx,row.lotId!,q.structureVersion);}
        await tx.paymentAttempt.create({data:{orderId:id,sandboxOutcome:dto.sandboxOutcome,state:'PENDING'}});
        await tx.paymentOrder.update({where:{id},data:{state:'PENDING'}});
      }
      return {response:null,row};
    });
    if(stage.response)return {body:stage.response,replayed:true};
    // Durable command and stable provider order ID precede all external side effects.
    const result=await this.external(()=>['CANCELLED','REFUND_PENDING','REFUNDED'].includes(stage.row.state)?this.provider.lookup(id):this.provider.capture(stage.row,dto.sandboxOutcome));
    return this.user(p,async tx=>{const cmd=await this.command(tx,p.userId,key,'attempt:'+id,dto);if(cmd.response)return {body:cmd.response,replayed:true};if(result)await this.apply(tx,await this.owned(tx,p.userId,id),result);return this.finish(tx,p.userId,key!,this.view(await this.owned(tx,p.userId,id)));});
  }
  private async refundPending(tx:Tx,row:FullOrder){await tx.paymentRefund.upsert({where:{orderId:row.id},create:{orderId:row.id,amountKrw:row.amountKrw,state:'PENDING'},update:{}});}
  private async apply(tx:Tx,row:FullOrder,result:ProviderPayment){
    verifyPayment(row,result,row.attempt?.transactionId);if(!row.attempt)throw new ApiError(409,'PAYMENT_ATTEMPT_NOT_FOUND');
    if((row.attempt.state==='FAILED' && result.status!=='FAILED') || (row.attempt.state==='SUCCEEDED' && result.status==='FAILED') || (row.state==='REFUNDED' && result.status!=='REFUNDED'))throw new ApiError(409,'PAYMENT_PROVIDER_STATE_CONFLICT');
    const paid=result.status!=='FAILED',now=await this.orderTime(tx,row);
    await tx.paymentAttempt.update({where:{orderId:row.id},data:{state:paid?'SUCCEEDED':'FAILED',transactionId:result.transactionId}});
    let state=paid?'SUCCEEDED':'FAILED';
    if(paid){
      if(!row.receipt){const id=randomUUID();await tx.paymentReceipt.create({data:{id,orderId:row.id,body:asJson({id,orderId:row.id,transactionId:result.transactionId,amountKrw:row.amountKrw,currency:row.currency,pricing:row.pricing,recordedAt:now.toISOString(),...paymentBoundary})}});}
      if(['CANCELLED','REFUND_PENDING','REFUNDED'].includes(row.state) || (row.state==='PENDING' && row.expiresAt<=now))state='REFUND_PENDING';
    }else if(row.state==='CANCELLED')state='CANCELLED';
    if(row.reservationId && await this.reservations.applyPayment(tx,row.reservationId,result.status) && paid)state='REFUND_PENDING';
    if(row.subscriptionCycleId && paid && await subscriptionNeedsCompensation(tx,row.subscriptionCycleId,now))state='REFUND_PENDING';
    if(result.status==='REFUNDED')state='REFUNDED';
    if(state==='REFUND_PENDING' || state==='REFUNDED'){
      await this.refundPending(tx,row);
      if(state==='REFUNDED')await tx.paymentRefund.update({where:{orderId:row.id},data:{state:'SUCCEEDED'}});
    }
    if(state!==row.state)await tx.paymentOrder.update({where:{id:row.id},data:{state}});
    if(row.subscriptionCycleId)await projectSubscriptionPayment(tx,row.subscriptionCycleId,row.id,state,now);
  }
  async cancel(p:Principal,id:string,key:string|undefined,reason:{reason:'USER_REQUEST'}){return this.mutate(p,key,'cancel:'+id,reason,async tx=>{
    const row=await this.owned(tx,p.userId,id);
    if(row.quoteId && ['CREATED','PENDING','SUCCEEDED'].includes(row.state)){
      const quote=await tx.paymentQuote.findUniqueOrThrow({where:{id:row.quoteId}});
      if(quote.startsAt<=await this.now(tx))throw new ApiError(409,'PAYMENT_CANCELLATION_CLOSED');
    }
    if(row.reservationId)await this.reservations.cancelPayment(tx,p.userId,row.reservationId);
    if(['CREATED','PENDING','SUCCEEDED'].includes(row.state)){
      const paid=row.state==='SUCCEEDED';if(paid)await this.refundPending(tx,row);
      await tx.paymentOrder.update({where:{id},data:{state:paid?'REFUND_PENDING':'CANCELLED'}});
      if(row.subscriptionCycleId)await projectSubscriptionPayment(tx,row.subscriptionCycleId,row.id,paid?'REFUND_PENDING':'CANCELLED',await this.orderTime(tx,row));
    }
    return this.view(await this.owned(tx,p.userId,id));
  });}
  async recover(p:Principal,id:string,key:string|undefined){
    const stage=await this.user(p,async tx=>{const cmd=await this.command(tx,p.userId,key,'recover:'+id,{});return {response:cmd.response,row:await this.owned(tx,p.userId,id)};});
    if(stage.response)return {body:stage.response,replayed:true};
    let result=await this.external(()=>this.provider.lookup(id));
    if(!result && stage.row.state==='PENDING' && stage.row.attempt)result=await this.external(()=>this.provider.capture(stage.row,stage.row.attempt!.sandboxOutcome as 'SUCCEEDED'|'FAILED'));
    if(result)await this.user(p,async tx=>this.apply(tx,await this.owned(tx,p.userId,id),result!));
    const row=await this.user(p,tx=>this.owned(tx,p.userId,id));
    if(row.state==='REFUND_PENDING'){
      if(!row.attempt?.transactionId)throw new ApiError(409,'PAYMENT_REFUND_NOT_READY');
      result=await this.external(()=>this.provider.refund(id,row.attempt!.transactionId!,row.amountKrw));
      await this.user(p,async tx=>this.apply(tx,await this.owned(tx,p.userId,id),result!));
    }
    return this.user(p,async tx=>{const cmd=await this.command(tx,p.userId,key,'recover:'+id,{});if(cmd.response)return {body:cmd.response,replayed:true};return this.finish(tx,p.userId,key!,this.view(await this.owned(tx,p.userId,id)));});
  }
  async webhook(raw:Buffer,timestamp:string|undefined,signature:string|undefined,dto:PaymentWebhookDto){
    this.enabled();this.provider.verifyWebhook(raw,timestamp,signature);
    // No user token is accepted as webhook authority. Signature and independent server lookup are mandatory.
    const found=await this.db.client.paymentOrder.findUnique({where:{id:dto.orderId}});if(!found)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const lookup=await this.external(()=>this.provider.lookup(found.id));if(!lookup)throw new ApiError(422,'PAYMENT_PROVIDER_NOT_FOUND');
    verifyPayment(found,lookup,dto.transactionId);verifyPayment(found,{...lookup,...dto},lookup.transactionId);
    return this.db.client.$transaction(async tx=>{
      await this.lock(tx,found.userId);
      // Global event key lock prevents the same event ID being concurrently applied to different users/orders.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'payment-event:'+dto.eventId},0))`;
      const hash=fingerprint(dto),old=await tx.paymentProviderEvent.findUnique({where:{eventId:dto.eventId}});
      if(old){if(old.requestHash!==hash)throw new ApiError(409,'PAYMENT_EVENT_CONFLICT');return old.response;}
      await this.apply(tx,await this.owned(tx,found.userId,found.id),lookup);
      const body={accepted:true,eventId:dto.eventId,...paymentBoundary};
      await tx.paymentProviderEvent.create({data:{eventId:dto.eventId,orderId:found.id,requestHash:hash,response:asJson(body)}});return body;
    });
  }
}
