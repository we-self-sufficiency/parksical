import { PracticeService } from '../practice/practice.service.js';
import { randomUUID } from 'node:crypto';
import { Inject,Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { AuthService,type Principal } from '../auth/auth.service.js';
import { APP_CONFIG,type AppConfig } from '../config.js';
import type { MissionRun,Prisma } from '../generated/prisma/client.js';
import { asJson } from '../lots/store.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { fingerprint,validateClock } from '../vehicle/normalization.js';
import type { CapabilitiesDto } from '../vehicle/dto.js';
import { cursorLocation,locationCursor } from '../locations/pagination.js';
import type { MissionQuery,RunCreateDto,RunPageQuery,RunResultDto } from './dto.js';
import { missionCatalog,missionRules,validateRunResult,type MissionRules,type StagePlan } from './rules.js';

type Tx=Prisma.TransactionClient;
@Injectable()
export class MissionService {
  constructor(private readonly auth:AuthService,@Inject(APP_CONFIG)private readonly config:AppConfig,private readonly practice:PracticeService){}
  enabled(){if(!this.config.devMissionsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'MISSIONS_POLICY_DISABLED');}
  private async lock(tx:Tx,p:Principal){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'mission-user:'+p.userId},0))`;}
  private async catalog(tx:Tx,q:MissionQuery){
    const rules=missionRules(q.ruleVersion);
    const lot=await tx.parkingLot.findUnique({where:{id:q.lotId}});
    if(!lot)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    const current=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId:q.lotId,version:lot.currentVersion}}});
    const revision=await tx.lotRevision.findUnique({where:{lotId_version:{lotId:q.lotId,version:q.structureVersion}}});
    if(!current.active || !revision?.active)throw new ApiError(422,'MISSION_STRUCTURE_UNAVAILABLE');
    if(revision.source!=='SYNTHETIC')throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
    return {lotId:q.lotId,structureVersion:q.structureVersion,...missionCatalog(revision.snapshot as unknown as LotSnapshotDto,rules)};
  }
  async missions(p:Principal,q:MissionQuery){this.enabled();return this.auth.forUser(p,tx=>this.catalog(tx,q));}
  private async owned(tx:Tx,p:Principal,id:string,write=false){
    const row=await tx.missionRun.findFirst({where:{id,userId:p.userId,...(p.kind==='VEHICLE'?{installationId:p.installationId!}:{}),...(write?{authSessionId:p.sessionId}: {})},include:{result:true}});
    if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');return row;
  }
  private async mutate(p:Principal,key:string|undefined,route:string,dto:unknown,action:(tx:Tx)=>Promise<{row:MissionRun;body:unknown;replayed?:boolean}>){
    this.enabled();if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');
    const requestHash=fingerprint({route,dto});
    return this.auth.forVehicle(p,async tx=>{
      await this.lock(tx,p);
      const previous=await tx.missionRunMutation.findUnique({where:{userId_installationId_key:{userId:p.userId,installationId:p.installationId!,key}}});
      if(previous){if(previous.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');await this.owned(tx,p,previous.runId,true);return {body:previous.response,replayed:true};}
      const result=await action(tx),body=asJson(result.body);
      await tx.missionRunMutation.create({data:{userId:p.userId,installationId:p.installationId!,key,runId:result.row.id,requestHash,response:body}});
      return {body,replayed:result.replayed??false};
    });
  }
  async create(p:Principal,key:string|undefined,dto:RunCreateDto){
    const input={...dto,startedAt:new Date(dto.startedAt).toISOString()};
    return this.mutate(p,key,'create',input,async tx=>{
      const creationHash=fingerprint(input);
      const old=await tx.missionRun.findUnique({where:{userId_installationId_clientRunId:{userId:p.userId,installationId:p.installationId!,clientRunId:dto.clientRunId}}});
      if(old){await this.owned(tx,p,old.id,true);if(old.creationHash!==creationHash)throw new ApiError(409,'RUN_CONFLICT');return {row:old,body:old.creationResponse,replayed:true};}
      validateClock(input.startedAt,new Date());
      const session=await tx.vehicleSession.findFirst({where:{id:dto.vehicleSessionId,userId:p.userId,installationId:p.installationId!,authSessionId:p.sessionId,reportedSource:'SYNTHETIC',state:'ACTIVE'}});
      if(!session)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:'+dto.lotId},0))`;
      const catalog=await this.catalog(tx,dto);
      const stages=dto.stageIds.map(id=>catalog.items.find(i=>i.stage?.stageId===id)?.stage);
      if(stages.some(s=>!s))throw new ApiError(422,'MISSION_UNSUPPORTED');
      const plans=stages as StagePlan[],capabilities=session.capabilities as unknown as CapabilitiesDto;
      for(const plan of plans)for(const signal of plan.requiredCapabilities){
        const capability=capabilities[signal],delta=new Date(input.startedAt).getTime()-new Date(capability.checkedAt).getTime();
        if(capability.status!=='SUPPORTED' || Math.abs(delta)>300000)throw new ApiError(422,'MISSION_UNSUPPORTED');
      }
      if(await tx.missionRun.count({where:{userId:p.userId}})>=1000)throw new ApiError(409,'RUN_COUNT_LIMIT');
      const id=randomUUID(),receivedAt=new Date();
      const body={runId:id,version:1,state:'ACTIVE',source:'SYNTHETIC',ruleVersion:dto.ruleVersion,structureVersion:dto.structureVersion,receivedAt:receivedAt.toISOString()};
      const row=await tx.missionRun.create({data:{id,userId:p.userId,installationId:p.installationId!,authSessionId:p.sessionId,vehicleSessionId:dto.vehicleSessionId,clientRunId:dto.clientRunId,creationHash,creationResponse:asJson(body),source:'SYNTHETIC',mode:dto.mode,lotId:dto.lotId,structureVersion:dto.structureVersion,ruleVersion:dto.ruleVersion,rules:asJson(catalog.rules),stages:asJson(plans),capabilities:session.capabilities as Prisma.InputJsonValue,startedAt:new Date(input.startedAt),receivedAt}});
      await this.practice.reconcile(tx,row);
      return {row,body};
    });
  }
  async result(p:Principal,id:string,key:string|undefined,dto:RunResultDto){
    const input={...dto,finishedAt:new Date(dto.finishedAt).toISOString()};
    return this.mutate(p,key,'result:'+id,input,async tx=>{
      const row=await this.owned(tx,p,id,true),requestHash=fingerprint(input);
      if(row.result){if(row.result.clientResultId!==dto.clientResultId || row.result.requestHash!==requestHash)throw new ApiError(409,'RUN_ALREADY_FINAL');return {row,body:row.result.receipt,replayed:true};}
      const assessment=validateRunResult(row.stages as unknown as StagePlan[],row.rules as unknown as MissionRules,row.startedAt,dto);
      const receivedAt=new Date(),body={runId:id,version:2,state:dto.outcome,source:'SYNTHETIC',receivedAt:receivedAt.toISOString(),...assessment};
      await tx.missionRunResult.create({data:{runId:id,clientResultId:dto.clientResultId,requestHash,source:'SYNTHETIC',outcome:dto.outcome,stars:dto.stars,finishedAt:new Date(input.finishedAt),elapsedMs:dto.elapsedMs,report:asJson(input),assessment:asJson(assessment),receipt:asJson(body),receivedAt}});
      await this.practice.reconcile(tx,row);
      return {row,body};
    });
  }
  private view(row:Awaited<ReturnType<MissionService['owned']>>){
    return {id:row.id,clientRunId:row.clientRunId,vehicleSessionId:row.vehicleSessionId,source:row.source,mode:row.mode,lotId:row.lotId,structureVersion:row.structureVersion,ruleVersion:row.ruleVersion,rules:row.rules,stages:row.stages,capabilities:row.capabilities,startedAt:row.startedAt.toISOString(),receivedAt:row.receivedAt.toISOString(),version:row.result?2:1,state:row.result?.outcome??'ACTIVE',result:row.result?{report:row.result.report,assessment:row.result.assessment,receivedAt:row.result.receivedAt.toISOString()}:null};
  }
  async get(p:Principal,id:string){this.enabled();return this.auth.forUser(p,async tx=>this.view(await this.owned(tx,p,id)));}
  async list(p:Principal,q:RunPageQuery){this.enabled();return this.auth.forUser(p,async tx=>{
    const limit=q.limit??20,binding=p.userId+':missions:'+p.kind+':'+(p.installationId??'web');
    const where={userId:p.userId,...(p.kind==='VEHICLE'?{installationId:p.installationId!}:{})};
    const anchor=q.cursor?await tx.missionRun.findFirst({where:{...where,id:cursorLocation(binding,limit,q.cursor)}}):null;
    if(q.cursor&&!anchor)throw new ApiError(400,'INVALID_RUN_CURSOR');
    const rows=await tx.missionRun.findMany({where:{...where,...(anchor?{OR:[{startedAt:{lt:anchor.startedAt}},{startedAt:anchor.startedAt,id:{lt:anchor.id}}]}:{})},orderBy:[{startedAt:'desc'},{id:'desc'}],take:limit+1,include:{result:true}});
    return {items:rows.slice(0,limit).map(r=>this.view(r)),nextCursor:rows.length>limit?locationCursor(binding,limit,rows[limit-1]!.id):null};
  });}
}
