import {randomUUID} from 'node:crypto';
import {Injectable} from '@nestjs/common';
import {ApiError} from '../api-error.js';
import type {Principal} from '../auth/auth.service.js';
import type {Prisma} from '../generated/prisma/client.js';
import {asJson} from '../lots/store.js';
import {monthOf} from '../rankings/rules.js';
import {RankingService} from '../rankings/ranking.service.js';
import {SubscriptionService} from '../subscriptions/subscription.service.js';
import {fingerprint} from '../vehicle/normalization.js';
import {RewardAccess} from './access.js';
import {RewardClock} from './clock.js';
import type {PrepareSettlementDto,RewardBatchDto} from './dto.js';
import {rewardBoundary,rewardPolicy,selectRewardCandidates,settlementBounds,type RewardCandidate} from './rules.js';
type Tx=Prisma.TransactionClient;
@Injectable()
export class SettlementService {
 constructor(private readonly access:RewardAccess,private readonly clock:RewardClock,private readonly rankings:RankingService,private readonly subscriptions:SubscriptionService){}
 private async lock(tx:Tx,month:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'reward-month:'+month},0))`;}
 private async view(tx:Tx,id:string){const r=await tx.rewardSettlement.findUnique({where:{id},include:{grants:{select:{state:true}}}});if(!r)throw new ApiError(404,'RESOURCE_NOT_FOUND');return {id:r.id,sourceMonth:r.sourceMonth,state:r.state,policyVersion:r.policyVersion,cutoffAt:r.cutoffAt.toISOString(),eligibilityAt:r.eligibilityAt.toISOString(),createdAt:r.createdAt.toISOString(),completedAt:r.completedAt?.toISOString()??null,inputHash:r.inputHash,counts:{selected:r.grants.length,pending:r.grants.filter(g=>g.state==='PENDING').length,issued:r.grants.filter(g=>g.state==='ISSUED').length,skipped:r.grants.filter(g=>g.state==='SKIPPED').length},policy:rewardPolicy,...rewardBoundary};}
 private async freeze(tx:Tx,id:string,now:Date){
  const row=await tx.rewardSettlement.findUniqueOrThrow({where:{id}});if(row.state!=='WAITING_CUTOFF' || now<row.cutoffAt)return;
  const inputs=await this.rankings.settlementInput(tx,row.sourceMonth,now),candidates:RewardCandidate[]=[];
  if(inputs.reduce((n,i)=>n+i.syntheticCandidates.length,0)>2000)throw new ApiError(503,'SETTLEMENT_SOURCE_LIMIT');
  const passes=new Map<string,boolean>();
  for(const i of inputs)for(const c of i.syntheticCandidates){if(!passes.has(c.userId))passes.set(c.userId,(await this.subscriptions.historicalEligibilityInTransaction(tx,c.userId,row.eligibilityAt,now)).syntheticPassActive);candidates.push({userId:c.userId,lotId:i.lotId,cohortKey:i.cohortKey,runId:c.runId,snapshotId:i.snapshotId,score:c.score,rank:c.rank,passActive:passes.get(c.userId)!});}
  const selected=selectRewardCandidates(candidates),manifest={inputs,selected,policy:rewardPolicy,sourceMonth:row.sourceMonth,eligibilityAt:row.eligibilityAt.toISOString(),operationalCandidates:[]};
  await tx.rewardSettlement.update({where:{id},data:{state:'READY',manifest:asJson(manifest),inputHash:fingerprint(manifest)}});
  if(selected.length)await tx.rewardGrant.createMany({data:selected.map(c=>({id:randomUUID(),settlementId:id,userId:c.userId,lotId:c.lotId,runId:c.runId,snapshotId:c.snapshotId,slot:c.slot,state:'PENDING',decision:asJson(c)}))});
 }
 async prepare(p:Principal,key:string|undefined,dto:PrepareSettlementDto){return this.access.mutate(p,key,'prepare',dto,async tx=>{
  const b=settlementBounds(dto.sourceMonth),now=await this.clock.now(tx);if(Date.parse(b.endsAt)>now.getTime())throw new ApiError(422,'SETTLEMENT_MONTH_NOT_ENDED');await this.lock(tx,dto.sourceMonth);
  let row=await tx.rewardSettlement.findUnique({where:{sourceMonth:dto.sourceMonth}});if(!row)row=await tx.rewardSettlement.create({data:{sourceMonth:dto.sourceMonth,policyVersion:dto.policyVersion,state:'WAITING_CUTOFF',cutoffAt:new Date(b.cutoffAt),eligibilityAt:new Date(b.eligibilityAt),createdAt:now}});
  await this.freeze(tx,row.id,now);return this.view(tx,row.id);
 },true);}
 async get(p:Principal,id:string){return this.access.admin(p,tx=>this.view(tx,id));}
 async process(p:Principal,id:string,key:string|undefined,dto:RewardBatchDto){return this.access.mutate(p,key,'process:'+id,dto,async tx=>{
  const row=await tx.rewardSettlement.findUnique({where:{id}});if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');await this.lock(tx,row.sourceMonth);const now=await this.clock.now(tx);await this.freeze(tx,id,now);
  if(now<row.cutoffAt)return this.view(tx,id);
  const grants=await tx.rewardGrant.findMany({where:{settlementId:id,state:'PENDING'},orderBy:[{userId:'asc'},{slot:'asc'}],take:dto.limit});
  for(const g of grants){
   const record=await tx.rankingRecord.findUnique({where:{runId:g.runId}}),lot=await tx.parkingLot.findUniqueOrThrow({where:{id:g.lotId}}),venue=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId:g.lotId,version:lot.currentVersion}}});
   if(!record || record.deletedAt || record.invalidatedAt || !venue.active || venue.source!=='SYNTHETIC' || !venue.partnered){await tx.rewardGrant.update({where:{id:g.id},data:{state:'SKIPPED'}});continue;}
   const coupon=await tx.sandboxCoupon.create({data:{grantId:g.id,userId:g.userId,lotId:g.lotId,sourceMonth:row.sourceMonth,issuedMonth:monthOf(now),slot:g.slot,policyVersion:rewardPolicy.version,state:'AVAILABLE',maxAmountKrw:rewardPolicy.maxAmountKrw,maxDurationMinutes:rewardPolicy.maxDurationMinutes,issuedAt:now,expiresAt:new Date(now.getTime()+rewardPolicy.validDays*86400000)}});
   await tx.rewardNotification.create({data:{couponId:coupon.id,state:'PENDING',nextAttemptAt:now}});await tx.rewardGrant.update({where:{id:g.id},data:{state:'ISSUED'}});
  }
  if(!await tx.rewardGrant.count({where:{settlementId:id,state:'PENDING'}}))await tx.rewardSettlement.updateMany({where:{id,state:'READY'},data:{state:'COMPLETED',completedAt:now}});
  return this.view(tx,id);
 },true);}
}
