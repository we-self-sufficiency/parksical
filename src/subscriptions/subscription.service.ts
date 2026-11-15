import {randomUUID} from 'node:crypto';
import {Inject,Injectable} from '@nestjs/common';
import {ApiError} from '../api-error.js';
import {AuthService,type Principal} from '../auth/auth.service.js';
import {APP_CONFIG,type AppConfig} from '../config.js';
import {DatabaseService} from '../database.service.js';
import type {Prisma} from '../generated/prisma/client.js';
import {asJson} from '../lots/store.js';
import {cursorLocation,locationCursor} from '../locations/pagination.js';
import type {RunPageQuery} from '../missions/dto.js';
import {PaymentService} from '../payments/payment.service.js';
import {fingerprint} from '../vehicle/normalization.js';
import {SubscriptionClock} from './clock.js';
import type {SubscribeDto,RenewSubscriptionDto,CancelSubscriptionDto} from './dto.js';
import {activeSubscriptionCycles,paymentUserLock} from './projection.js';
import {coverageAt,monthBoundary,renewalWindow,subscriptionBoundary,subscriptionProduct} from './rules.js';
type Tx=Prisma.TransactionClient;
const included={cycles:{include:{order:true},orderBy:{cycleIndex:'desc' as const}}} as const;
type Sub=Prisma.SubscriptionGetPayload<{include:typeof included}>;
@Injectable()
export class SubscriptionService {
  constructor(private readonly auth:AuthService,private readonly database:DatabaseService,private readonly payments:PaymentService,private readonly clock:SubscriptionClock,@Inject(APP_CONFIG) private readonly config:AppConfig){}
  enabled(){if(!this.config.devSubscriptionsEnabled || !this.config.devPaymentsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'SUBSCRIPTIONS_POLICY_DISABLED');}
  private async locked<T>(p:Principal,work:(tx:Tx)=>Promise<T>){this.enabled();return this.auth.forUser(p,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'reservation-user:'+p.userId},0))`;await paymentUserLock(tx,p.userId);return work(tx);
  });}
  private async owned(tx:Tx,userId:string,id:string){const row=await tx.subscription.findFirst({where:{id,userId},include:included});if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');return row;}
  private cycle(c:Sub['cycles'][number]){return {id:c.id,cycleIndex:c.cycleIndex,startsAt:c.startsAt.toISOString(),endsAt:c.endsAt.toISOString(),chargeDeadline:c.chargeDeadline.toISOString(),amountKrw:c.amountKrw,currency:'KRW',paymentOrderId:c.order!.id,paymentState:c.order!.state,paidAt:c.paidAt?.toISOString()??null,revokedAt:c.revokedAt?.toISOString()??null};}
  private view(row:Sub,now:Date){
    const active=row.cycles.some(c=>coverageAt(c,now)),scheduled=row.cycles.some(c=>c.paidAt && c.startsAt>now && !c.revokedAt),last=row.cycles[0]!,pending=['CREATED','PENDING'].includes(last.order!.state) && now<last.chargeDeadline;
    const state=active?(row.renewalEnabled?'ACTIVE':'CANCEL_AT_PERIOD_END'):scheduled?'SCHEDULED':pending?'PENDING':last.order!.state==='FAILED'?'PAYMENT_FAILED':last.order!.state==='REFUNDED'?'REFUNDED':last.order!.state==='CANCELLED'?'CANCELLED':'EXPIRED';
    return {id:row.id,planCode:row.planCode,priceVersion:row.priceVersion,policyVersion:row.policyVersion,state,renewalEnabled:row.renewalEnabled,cancelledAt:row.cancelledAt?.toISOString()??null,anchorAt:row.anchorAt.toISOString(),checkedAt:now.toISOString(),latestCycle:this.cycle(last),...subscriptionBoundary};
  }
  private async mutate(p:Principal,key:string|undefined,route:string,dto:unknown,action:(tx:Tx)=>Promise<unknown>){
    if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');
    return this.locked(p,async tx=>{
      const where={userId_key:{userId:p.userId,key}},hash=fingerprint({route,dto}),old=await tx.subscriptionMutation.findUnique({where});
      if(old){if(old.requestHash!==hash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return {body:old.response,replayed:true};}
      if(!route.startsWith('cancel:') && await tx.subscriptionMutation.count({where:{userId:p.userId}})>=4000)throw new ApiError(409,'SUBSCRIPTION_COMMAND_LIMIT');
      const body=asJson(await action(tx));await tx.subscriptionMutation.create({data:{userId:p.userId,key,requestHash:hash,response:body}});return {body,replayed:false};
    });
  }
  private async newCycle(tx:Tx,sub:{id:string;userId:string;anchorAt:Date},index:number,now:Date){
    if(await tx.subscriptionCycle.count({where:{subscription:{userId:sub.userId}}})>=1000)throw new ApiError(409,'SUBSCRIPTION_CYCLE_LIMIT');
    const startsAt=monthBoundary(sub.anchorAt,index),endsAt=monthBoundary(sub.anchorAt,index+1),id=randomUUID(),chargeDeadline=new Date(startsAt.getTime()+300000);
    const pricing={...subscriptionProduct,cycleIndex:index,startsAt:startsAt.toISOString(),endsAt:endsAt.toISOString()};
    await tx.subscriptionCycle.create({data:{id,subscriptionId:sub.id,cycleIndex:index,startsAt,endsAt,chargeDeadline,amountKrw:subscriptionProduct.amountKrw,pricing:asJson(pricing)}});
    await this.payments.createSubscriptionOrder(tx,sub.userId,id,now);
    return id;
  }
  async products(p:Principal){return this.locked(p,async()=>({items:[subscriptionProduct],...subscriptionBoundary}));}
  async subscribe(p:Principal,key:string|undefined,dto:SubscribeDto){return this.mutate(p,key,'subscribe',dto,async tx=>{
    const now=await this.clock.now(tx);
    const existing=await tx.subscription.findFirst({where:{userId:p.userId,OR:[{cycles:{some:{paidAt:{not:null},endsAt:{gt:now},OR:[{revokedAt:null},{revokedAt:{gt:now}}]}}},{cycles:{some:{order:{state:{in:['CREATED','PENDING']},expiresAt:{gt:now}}}}}]},include:included,orderBy:[{createdAt:'desc'},{id:'desc'}]});
    if(existing)return this.view(existing,now);
    const previous=await tx.subscription.findMany({where:{userId:p.userId,renewalEnabled:true}});
    for(const old of previous){await tx.subscription.update({where:{id:old.id},data:{renewalEnabled:false,cancelledAt:now}});await this.payments.cancelPendingSubscriptionOrders(tx,old.id,now);await tx.subscriptionChange.create({data:{subscriptionId:old.id,kind:'SUPERSEDED',observedAt:now,details:{}}});}
    if(await tx.subscription.count({where:{userId:p.userId}})>=1000)throw new ApiError(409,'SUBSCRIPTION_COUNT_LIMIT');
    const id=randomUUID();await tx.subscription.create({data:{id,userId:p.userId,planCode:subscriptionProduct.code,priceVersion:dto.priceVersion,policyVersion:dto.policyVersion,anchorAt:now,createdAt:now}});
    await this.newCycle(tx,{id,userId:p.userId,anchorAt:now},0,now);
    await tx.subscriptionChange.create({data:{subscriptionId:id,kind:'CREATED',observedAt:now,details:asJson({priceVersion:dto.priceVersion,policyVersion:dto.policyVersion})}});
    return this.view(await this.owned(tx,p.userId,id),now);
  });}
  async me(p:Principal){return this.locked(p,async tx=>{const now=await this.clock.now(tx),row=await tx.subscription.findFirst({where:{userId:p.userId},include:included,orderBy:[{createdAt:'desc'},{id:'desc'}]});return {subscription:row?this.view(row,now):null,...subscriptionBoundary};});}
  async get(p:Principal,id:string){return this.locked(p,async tx=>this.view(await this.owned(tx,p.userId,id),await this.clock.now(tx)));}
  async renew(p:Principal,id:string,key:string|undefined,dto:RenewSubscriptionDto){return this.mutate(p,key,'renew:'+id,dto,async tx=>{
    const row=await this.owned(tx,p.userId,id),now=await this.clock.now(tx),target=dto.expectedCycleIndex+1,existing=row.cycles.find(c=>c.cycleIndex===target);
    if(existing)return {subscriptionId:id,cycle:this.cycle(existing),...subscriptionBoundary};
    const last=row.cycles[0]!;
    if(!row.renewalEnabled)throw new ApiError(409,'SUBSCRIPTION_RENEWAL_CANCELLED');
    if(last.cycleIndex!==dto.expectedCycleIndex || last.order!.state!=='SUCCEEDED' || last.revokedAt)throw new ApiError(409,'SUBSCRIPTION_RENEWAL_CONFLICT');
    renewalWindow(last.endsAt,now);await this.newCycle(tx,row,target,now);
    return {subscriptionId:id,cycle:this.cycle((await this.owned(tx,p.userId,id)).cycles[0]!),...subscriptionBoundary};
  });}
  async cancel(p:Principal,id:string,key:string|undefined,dto:CancelSubscriptionDto){return this.mutate(p,key,'cancel:'+id,dto,async tx=>{
    const row=await this.owned(tx,p.userId,id),now=await this.clock.now(tx);
    if(row.renewalEnabled){await tx.subscription.update({where:{id},data:{renewalEnabled:false,cancelledAt:now}});await this.payments.cancelPendingSubscriptionOrders(tx,id,now);await tx.subscriptionChange.create({data:{subscriptionId:id,kind:'CANCELLED_RENEWAL',observedAt:now,details:asJson(dto)}});}
    return this.view(await this.owned(tx,p.userId,id),now);
  });}
  async history(p:Principal,id:string,q:RunPageQuery){return this.locked(p,async tx=>{
    await this.owned(tx,p.userId,id);const limit=q.limit??20,binding=p.userId+':subscription:'+id,rows=await tx.subscriptionChange.findMany({where:{subscriptionId:id},orderBy:[{observedAt:'desc'},{id:'desc'}]});
    const anchor=q.cursor?cursorLocation(binding,limit,q.cursor):null,index=anchor?rows.findIndex(r=>r.id===anchor):-1;if(anchor && index<0)throw new ApiError(400,'INVALID_SUBSCRIPTION_CURSOR');const rest=rows.slice(index+1);
    return {items:rest.slice(0,limit).map(r=>({id:r.id,cycleId:r.cycleId,kind:r.kind,observedAt:r.observedAt.toISOString(),details:r.details})),nextCursor:rest.length>limit?locationCursor(binding,limit,rest[limit-1]!.id):null,...subscriptionBoundary};
  });}
  private async eligibility(tx:Tx,userId:string,at:Date){
    const cycles=await activeSubscriptionCycles(tx,userId,at),active=cycles.length>0;
    return {at:at.toISOString(),syntheticPassActive:active,capabilities:{challengeStart:active,practiceStart:active,reservationCreate:active,rankingRead:active},evidenceCycleIds:cycles.map(c=>c.id),policyVersion:subscriptionProduct.policyVersion,settlementTimePolicy:'UNDECIDED',...subscriptionBoundary};
  }
  async entitlements(p:Principal){return this.locked(p,async tx=>this.eligibility(tx,p.userId,await this.clock.now(tx)));}
  // Internal S-18 port. Caller must select and version its actual settlement instant separately.
  async historicalEligibilityInTransaction(tx:Tx,userId:string,at:Date,now:Date){
    this.enabled();if(at>=now || !Number.isFinite(at.getTime()))throw new ApiError(422,'INVALID_SUBSCRIPTION_AS_OF');
    // Observed paidAt/revokedAt never backdate. A fixed past cutoff is stable without taking a live payment lock.
    return this.eligibility(tx,userId,at);
  }
  async eligibilityAt(userId:string,at:Date){
    this.enabled();return this.database.client.$transaction(async tx=>{await paymentUserLock(tx,userId);const now=await this.clock.now(tx);if(!Number.isFinite(at.getTime()) || at>now || at<new Date('2000-01-01T00:00:00.000Z'))throw new ApiError(422,'INVALID_SUBSCRIPTION_AS_OF');return this.eligibility(tx,userId,at);});
  }
}
