import {randomUUID} from 'node:crypto';
import {Injectable} from '@nestjs/common';
import {ApiError} from '../api-error.js';
import type {Principal} from '../auth/auth.service.js';
import type {Prisma,SandboxCoupon} from '../generated/prisma/client.js';
import {cursorLocation,locationCursor} from '../locations/pagination.js';
import type {RunPageQuery} from '../missions/dto.js';
import {PaymentService} from '../payments/payment.service.js';
import {RewardAccess} from './access.js';
import {RewardClock} from './clock.js';
import type {CouponActionDto,CouponHoldDto} from './dto.js';
import {requireValidRewardSource} from './projection.js';
import {couponLimits,rewardBoundary} from './rules.js';
type Tx=Prisma.TransactionClient;
@Injectable()
export class CouponService {
 constructor(private readonly access:RewardAccess,private readonly clock:RewardClock,private readonly payments:PaymentService){}
 private async owned(tx:Tx,userId:string,id:string){const c=await tx.sandboxCoupon.findFirst({where:{id,userId}});if(!c)throw new ApiError(404,'RESOURCE_NOT_FOUND');return c;}
 private async sweep(tx:Tx,c:SandboxCoupon,now:Date){
  if(c.state==='HELD'){const claim=await tx.couponClaim.findFirst({where:{couponId:c.id,state:'HELD'}});if(claim && (claim.holdExpiresAt<=now || c.expiresAt<=now)){await tx.couponClaim.update({where:{id:claim.id},data:{state:'RELEASED'}});c=await tx.sandboxCoupon.update({where:{id:c.id},data:{state:c.expiresAt<=now?'EXPIRED':'AVAILABLE'}});}}
  if(c.state==='AVAILABLE' && c.expiresAt<=now)c=await tx.sandboxCoupon.update({where:{id:c.id},data:{state:'EXPIRED'}});return c;
 }
 private async view(tx:Tx,c:SandboxCoupon,now:Date){const grant=await tx.rewardGrant.findUniqueOrThrow({where:{id:c.grantId}}),record=await tx.rankingRecord.findUnique({where:{runId:grant.runId}});return {id:c.id,lotId:c.lotId,sourceMonth:c.sourceMonth,issuedMonth:c.issuedMonth,slot:c.slot,policyVersion:c.policyVersion,state:c.state,maxAmountKrw:c.maxAmountKrw,maxDurationMinutes:c.maxDurationMinutes,issuedAt:c.issuedAt.toISOString(),expiresAt:c.expiresAt.toISOString(),usable:c.state==='AVAILABLE' && c.expiresAt>now && !!record && !record.invalidatedAt && !record.deletedAt,...rewardBoundary};}
 async get(p:Principal,id:string){return this.access.user(p,async tx=>{const now=await this.clock.now(tx);return this.view(tx,await this.sweep(tx,await this.owned(tx,p.userId,id),now),now);});}
 async mine(p:Principal,q:RunPageQuery){return this.access.user(p,async tx=>{
  const now=await this.clock.now(tx),limit=q.limit??20,binding=p.userId+':coupons',rows=await tx.sandboxCoupon.findMany({where:{userId:p.userId},orderBy:[{issuedAt:'desc'},{id:'desc'}]});const anchor=q.cursor?cursorLocation(binding,limit,q.cursor):null,index=anchor?rows.findIndex(r=>r.id===anchor):-1;if(anchor && index<0)throw new ApiError(400,'INVALID_COUPON_CURSOR');const rest=rows.slice(index+1),items=[];
  for(const c of rest.slice(0,limit))items.push(await this.view(tx,await this.sweep(tx,c,now),now));return {items,nextCursor:rest.length>limit?locationCursor(binding,limit,rest[limit-1]!.id):null,...rewardBoundary};
 });}
 async hold(p:Principal,id:string,key:string|undefined,dto:CouponHoldDto){return this.access.mutate(p,key,'coupon-hold:'+id,dto,async tx=>{
  const now=await this.clock.now(tx),c=await this.sweep(tx,await this.owned(tx,p.userId,id),now),{row,durationMinutes}=await this.payments.validateCouponOrder(tx,p.userId,dto.paymentOrderId,now);
  if(c.state!=='AVAILABLE' || c.expiresAt<=now)throw new ApiError(409,'COUPON_UNAVAILABLE');if(c.lotId!==row.lotId)throw new ApiError(422,'COUPON_LOT_MISMATCH');couponLimits(row.amountKrw,durationMinutes,c.maxAmountKrw,c.maxDurationMinutes);const g=await tx.rewardGrant.findUniqueOrThrow({where:{id:c.grantId}});await requireValidRewardSource(tx,g.runId,true);
  if(row.couponClaim)throw new ApiError(409,'COUPON_ORDER_ALREADY_CLAIMED');const claim=await tx.couponClaim.create({data:{id:randomUUID(),couponId:id,orderId:row.id,state:'HELD',amountKrw:row.amountKrw,durationMinutes,createdAt:now,holdExpiresAt:new Date(Math.min(row.expiresAt.getTime(),c.expiresAt.getTime(),now.getTime()+300000))}});await tx.sandboxCoupon.update({where:{id},data:{state:'HELD'}});
  return {claimId:claim.id,couponId:id,paymentOrderId:row.id,state:'HELD',holdExpiresAt:claim.holdExpiresAt.toISOString(),coveredAmountKrw:claim.amountKrw,...rewardBoundary};
 });}
 private async claim(tx:Tx,p:Principal,id:string,claimId:string){const row=await tx.couponClaim.findFirst({where:{id:claimId,couponId:id,coupon:{userId:p.userId}}});if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');return row;}
 async consume(p:Principal,id:string,claimId:string,key:string|undefined,dto:CouponActionDto){return this.access.mutate(p,key,'coupon-consume:'+id+':'+claimId,dto,async tx=>{const c=await this.claim(tx,p,id,claimId);if(c.receipt)return c.receipt;return this.payments.settleCoupon(tx,p.userId,claimId,await this.clock.now(tx));});}
 async release(p:Principal,id:string,claimId:string,key:string|undefined,dto:CouponActionDto){return this.access.mutate(p,key,'coupon-release:'+id+':'+claimId,dto,async tx=>{const claim=await this.claim(tx,p,id,claimId);if(claim.state==='CONSUMED'||claim.state==='VOIDED')throw new ApiError(409,'COUPON_ALREADY_CONSUMED');const now=await this.clock.now(tx),c=await this.owned(tx,p.userId,id);if(claim.state==='HELD'){await tx.couponClaim.update({where:{id:claimId},data:{state:'RELEASED'}});await tx.sandboxCoupon.update({where:{id},data:{state:c.expiresAt<=now?'EXPIRED':'AVAILABLE'}});}return this.view(tx,await this.owned(tx,p.userId,id),now);});}
 async cancel(p:Principal,id:string,key:string|undefined,dto:CouponActionDto){return this.access.mutate(p,key,'coupon-cancel:'+id,dto,async tx=>{
  const now=await this.clock.now(tx),c=await this.sweep(tx,await this.owned(tx,p.userId,id),now);if(c.state==='USED'){const claim=await tx.couponClaim.findFirstOrThrow({where:{couponId:id,state:'CONSUMED'}});await this.payments.cancelCouponSettlement(tx,p.userId,claim.orderId,now);}else if(['AVAILABLE','HELD'].includes(c.state)){await tx.couponClaim.updateMany({where:{couponId:id,state:'HELD'},data:{state:'RELEASED'}});await tx.sandboxCoupon.update({where:{id},data:{state:'CANCELLED'}});}return this.view(tx,await this.owned(tx,p.userId,id),now);
 });}
}
