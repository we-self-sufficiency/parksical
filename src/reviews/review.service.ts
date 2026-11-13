import { randomUUID } from 'node:crypto';
import { Inject,Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { APP_CONFIG,type AppConfig } from '../config.js';
import { AuthService,type Principal } from '../auth/auth.service.js';
import type { Prisma,Review } from '../generated/prisma/client.js';
import { fingerprint } from '../vehicle/normalization.js';
import { asJson } from '../lots/store.js';
import type { AggregateQuery,ReviewCreateDto,ReviewRebuildDto,ReviewUpdateDto,ReviewVersionDto } from './dto.js';
import { reviewEvidence,REVIEW_RULE_VERSION } from './aggregation.js';

type Tx=Prisma.TransactionClient;
export const privateReview=(r:Review)=>({id:r.id,visitId:r.visitId,rating:r.rating,version:r.version,source:'SYNTHETIC' as const,createdAt:r.createdAt.toISOString(),updatedAt:r.updatedAt.toISOString()});
@Injectable()
export class ReviewService {
  constructor(private readonly auth:AuthService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
  enabled(){if(!this.config.devReviewsEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'REVIEWS_POLICY_DISABLED');}
  private async active(tx:Tx,lotId:string,version?:number) {
    const lot=await tx.parkingLot.findUnique({where:{id:lotId}});
    if(!lot)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const current=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId,version:lot.currentVersion}}});
    const revision=version===undefined || version===current.version?current:await tx.lotRevision.findUnique({where:{lotId_version:{lotId,version}}});
    if(!current.active || !revision?.active)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    if(revision.source!=='SYNTHETIC')throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
    return revision;
  }
  private async aggregate(tx:Tx,lotId:string,lotVersion:number) {
    // One visit per account/revision; lock serializes all writes and rebuilds for this lot.
    const totals=await tx.$queryRaw<{sampleCount:bigint;scoreSum:bigint}[]>`SELECT count(*) AS "sampleCount",coalesce(sum(CASE r.rating WHEN 'EASY' THEN 1 WHEN 'NORMAL' THEN 3 WHEN 'HARD' THEN 5 END),0)::bigint AS "scoreSum"
      FROM "Review" r JOIN "ReviewVisit" v ON v.id=r."visitId" WHERE v."lotId"=${lotId}::uuid AND v."lotVersion"=${lotVersion} AND v.source='SYNTHETIC' AND r."deletedAt" IS NULL`;
    const count=Number(totals[0]!.sampleCount);
    if(count>2147483647)throw new ApiError(409,'AGGREGATE_COUNT_EXHAUSTED');
    const previous=await tx.reviewAggregate.findUnique({where:{lotId_lotVersion:{lotId,lotVersion}}});
    if(previous?.version===2147483647)throw new ApiError(409,'AGGREGATE_VERSION_EXHAUSTED');
    return tx.reviewAggregate.upsert({where:{lotId_lotVersion:{lotId,lotVersion}},create:{lotId,lotVersion,source:'SYNTHETIC',scoreSum:totals[0]!.scoreSum,sampleCount:count,version:1,updatedAt:new Date()},update:{scoreSum:totals[0]!.scoreSum,sampleCount:count,version:{increment:1},updatedAt:new Date()}});
  }
  private async mutate(p:Principal,key:string|undefined,route:string,dto:unknown,admin:boolean,work:(tx:Tx)=>Promise<unknown>){
    this.enabled();if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');
    const requestHash=fingerprint({route,dto});
    const action=async(tx:Tx)=>{
      const old=await tx.reviewMutation.findUnique({where:{authSessionId_key:{authSessionId:p.sessionId,key}}});
      if(old){if(old.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return {body:old.response,replayed:true};}
      const body=asJson(await work(tx));
      await tx.reviewMutation.create({data:{authSessionId:p.sessionId,key,requestHash,response:body}});return {body,replayed:false};
    };
    return admin?this.auth.forAdmin(p,action):this.auth.forUser(p,action);
  }
  async create(p:Principal,key:string|undefined,dto:ReviewCreateDto){
    return this.mutate(p,key,'create',dto,false,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:'+dto.lotId},0))`;
      // Check ownership without revealing another account's visit or lot membership.
      const visit=await tx.reviewVisit.findFirst({where:{id:dto.visitId,userId:p.userId,lotId:dto.lotId,lotVersion:dto.lotVersion,source:'SYNTHETIC'}});
      if(!visit)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      await this.active(tx,dto.lotId,dto.lotVersion);
      const existing=await tx.review.findUnique({where:{visitId:visit.id}});
      if(existing)throw new ApiError(409,existing.deletedAt?'REVIEW_DELETED':'REVIEW_ALREADY_EXISTS');
      const review=await tx.review.create({data:{id:randomUUID(),visitId:visit.id,rating:dto.rating}});
      const aggregate=await this.aggregate(tx,visit.lotId,visit.lotVersion);
      return {reviewId:review.id,version:review.version,deleted:false,aggregateVersion:aggregate.version};
    });
  }
  async update(p:Principal,id:string,key:string|undefined,dto:ReviewUpdateDto|ReviewVersionDto,deleting=false){
    return this.mutate(p,key,(deleting?'delete:':'update:')+id,dto,false,async tx=>{
      let review=await tx.review.findFirst({where:{id,visit:{userId:p.userId}},include:{visit:true}});
      if(!review)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:'+review.visit.lotId},0))`;
      review=await tx.review.findFirst({where:{id,visit:{userId:p.userId}},include:{visit:true}});
      if(!review || review.deletedAt)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      if(review.version!==dto.expectedVersion)throw new ApiError(409,'REVIEW_VERSION_CONFLICT');
      // Deletion remains possible after a lot is disabled. Updates require an active revision.
      if(!deleting)await this.active(tx,review.visit.lotId,review.visit.lotVersion);
      const updated=await tx.review.update({where:{id},data:{rating:deleting?null:(dto as ReviewUpdateDto).rating,deletedAt:deleting?new Date():null,version:{increment:1}}});
      const aggregate=await this.aggregate(tx,review.visit.lotId,review.visit.lotVersion);
      return {reviewId:id,version:updated.version,deleted:deleting,aggregateVersion:aggregate.version};
    });
  }
  async get(p:Principal,id:string){this.enabled();return this.auth.forUser(p,async tx=>{
    const r=await tx.review.findFirst({where:{id,visit:{userId:p.userId},deletedAt:null}});
    if(!r)throw new ApiError(404,'RESOURCE_NOT_FOUND');return privateReview(r);
  });}
  async mine(p:Principal,lotId:string,lotVersion:number){this.enabled();return this.auth.forUser(p,async tx=>{
    const r=await tx.review.findFirst({where:{visit:{userId:p.userId,lotId,lotVersion},deletedAt:null}});return {review:r?privateReview(r):null};
  });}
  async summary(p:Principal,lotId:string,q:AggregateQuery){this.enabled();return this.auth.forUser(p,async tx=>{
    const revision=await this.active(tx,lotId,q.lotVersion);
    const aggregate=await tx.reviewAggregate.findUnique({where:{lotId_lotVersion:{lotId,lotVersion:revision.version}}});
    const evidence=reviewEvidence(true,aggregate);
    return {lotId,lotVersion:revision.version,...evidence.metadata,score:evidence.publishedScore};
  });}
  async rebuild(p:Principal,lotId:string,version:number,key:string|undefined,dto:ReviewRebuildDto){
    return this.mutate(p,key,'rebuild:'+lotId+':'+version,dto,true,async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:'+lotId},0))`;
      // Allow repairing historical/inactive aggregates; no public read bypass follows.
      const revision=await tx.lotRevision.findUnique({where:{lotId_version:{lotId,version}}});
      if(!revision)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      if(revision.source!=='SYNTHETIC')throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
      const aggregate=await this.aggregate(tx,lotId,version);
      return {lotId,lotVersion:version,aggregateVersion:aggregate.version,ruleVersion:REVIEW_RULE_VERSION};
    });
  }
}
