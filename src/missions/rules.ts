import { ApiError } from '../api-error.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import type { Signal } from '../vehicle/dto.js';
import type { QualitySignal,RunResultDto,StageOutcome,StageReason,StageResultDto } from './dto.js';

export const MISSION_RULE_VERSION='missions-v1';
export const MISSION_CODES=['NO_STOP_RAMP','ONE_SHOT_REVERSE','PILLAR_FOREST','SMOOTH_STEERING','TIME_ATTACK'] as const;
export type MissionCode=typeof MISSION_CODES[number];
export interface StagePlan {
  stageId:string; missionCode:MissionCode; floorId:string; zoneId:string; rampId:string|null; parkingSpaceId:string|null;
  requiredCapabilities:Signal[]; requiredQuality:QualitySignal[];
}
export interface MissionRules {
  version:string; maxSpeedKph:number; maxElapsedMs:number; maxGapMs:number; minContinuousSamples:number; clockToleranceMs:number;
  scoring:{noStopStars:number;oneReverseStars:number;smoothMaxStars:number};
}
// Test policy only. These bounds are not SDK rates, hardware guarantees or approved operating limits.
export function missionRules(version=MISSION_RULE_VERSION):MissionRules {
  if(version!==MISSION_RULE_VERSION)throw new ApiError(422,'MISSION_RULE_UNSUPPORTED');
  return {version,maxSpeedKph:10,maxElapsedMs:7200000,maxGapMs:1000,minContinuousSamples:2,clockToleranceMs:5000,scoring:{noStopStars:3,oneReverseStars:3,smoothMaxStars:3}};
}
export function missionCatalog(snapshot:LotSnapshotDto,rules=missionRules()) {
  const ramp=snapshot.ramps.filter(r=>r.fromZoneId!==null).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[0];
  const space=[...(snapshot.parkingSpaces??[])].filter(s=>s.active && s.type==='GENERAL').sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[0];
  const zone=[...snapshot.zones].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[0];
  const common:QualitySignal[]=['speed','gear','segment','riskEvents'];
  const plans:Partial<Record<MissionCode,StagePlan>>={};
  if(ramp?.fromZoneId)plans.NO_STOP_RAMP={stageId:'NO_STOP_RAMP:'+ramp.id,missionCode:'NO_STOP_RAMP',floorId:ramp.fromFloorId,zoneId:ramp.fromZoneId,rampId:ramp.id,parkingSpaceId:null,requiredCapabilities:['speed','gear'],requiredQuality:[...common]};
  if(space)plans.ONE_SHOT_REVERSE={stageId:'ONE_SHOT_REVERSE:'+space.id,missionCode:'ONE_SHOT_REVERSE',floorId:space.floorId,zoneId:space.zoneId,rampId:null,parkingSpaceId:space.id,requiredCapabilities:['speed','gear'],requiredQuality:[...common]};
  if(zone)plans.SMOOTH_STEERING={stageId:'SMOOTH_STEERING:'+zone.id,missionCode:'SMOOTH_STEERING',floorId:zone.floorId,zoneId:zone.id,rampId:null,parkingSpaceId:null,requiredCapabilities:['speed','gear','steeringAngle'],requiredQuality:[...common,'steeringAngle']};
  return {ruleVersion:rules.version,rules,source:'SYNTHETIC' as const,operationalAllowed:false as const,items:MISSION_CODES.map(code=>({missionCode:code,developmentStatus:plans[code]?'SYNTHETIC_ONLY' as const:'DISABLED' as const,
    disabledReason:code==='PILLAR_FOREST'?'OBSTACLE_EVIDENCE_UNCONFIRMED':code==='TIME_ATTACK'?'SPEED_INCENTIVE_EXCLUDED':!plans[code]?'SEGMENT_NOT_CONFIGURED':null,stage:plans[code]??null,physicalSupport:'UNCONFIRMED' as const}))};
}
function reject(code='INVALID_RUN_RESULT'):never {throw new ApiError(422,code);}
function match(stage:StageResultDto,outcome:StageOutcome,reason:StageReason,stars=0) {
  if(stage.outcome!==outcome || stage.reason!==reason || stage.stars!==stars)reject('STAGE_RESULT_MISMATCH');
}
export function validateStage(plan:StagePlan,stage:StageResultDto,rules:MissionRules) {
  const duration=stage.endOffsetMs-stage.startOffsetMs;
  if(stage.stageId!==plan.stageId || duration<=0)reject('INVALID_STAGE_REFERENCE');
  if(stage.quality.length!==plan.requiredQuality.length || plan.requiredQuality.some(s=>!stage.quality.some(q=>q.signal===s)))reject('INVALID_SIGNAL_QUALITY');
  if(stage.metrics.movingDurationMs!==null && stage.metrics.movingDurationMs>duration)reject('INVALID_MOVEMENT_DURATION');
  if(plan.missionCode!=='ONE_SHOT_REVERSE' && stage.parkingConfirmed!==null)reject('UNEXPECTED_MISSION_METRIC');
  if(stage.quality.some(q=>q.coveredMs>duration || (q.status!=='AVAILABLE' && (q.validSampleCount!==0 || q.coveredMs!==0 || q.maxGapMs!==null))))reject('INVALID_SIGNAL_QUALITY');
  const usable=(signal:QualitySignal)=>{const q=stage.quality.find(q=>q.signal===signal)!;return q.status==='AVAILABLE' && q.coveredMs===duration && q.validSampleCount>=(['speed','steeringAngle'].includes(signal)?rules.minContinuousSamples:1) && q.maxGapMs!==null && q.maxGapMs<=rules.maxGapMs && (!['speed','steeringAngle'].includes(signal) || (q.maxGapMs>0 && q.validSampleCount>=Math.ceil(duration/q.maxGapMs)+1));};
  const m=stage.metrics;
  if(m.gearTransitionCount!==undefined && m.gearTransitionCount!==null){
    const gear=stage.quality.find(q=>q.signal==='gear');
    if(!gear || gear.status!=='AVAILABLE' || m.gearTransitionCount>Math.max(0,gear.validSampleCount-1))reject('INVALID_GEAR_TRANSITION_COUNT');
  }
  const metric=plan.missionCode==='NO_STOP_RAMP'?'stopCount':plan.missionCode==='ONE_SHOT_REVERSE'?'reverseSegmentCount':'abruptSteeringCount';
  if(['stopCount','reverseSegmentCount','abruptSteeringCount'].some(k=>k!==metric && m[k as keyof typeof m]!==null))reject('UNEXPECTED_MISSION_METRIC');
  // Summary-level precedence is deterministic; it does not claim the chronology of physical events.
  if(stage.uxState==='RESTRICTED')return match(stage,'ABORTED','UX_RESTRICTED');
  if(usable('speed') && m.maxSpeedKph!==null && m.maxSpeedKph>rules.maxSpeedKph)return match(stage,'ABORTED','SPEED_LIMIT');
  if(usable('riskEvents') && m.dangerEventCount!==null && m.dangerEventCount>0)return match(stage,'ABORTED','DANGER_EVENT');
  if(stage.uxState==='UNKNOWN')return match(stage,'UNVERIFIABLE','UX_UNKNOWN');
  if(plan.requiredQuality.some(s=>!usable(s)) || m.maxSpeedKph===null || m.dangerEventCount===null || m[metric]===null)return match(stage,'UNVERIFIABLE','SIGNAL_QUALITY');
  if(stage.reason==='APP_RESTARTED')return match(stage,'UNVERIFIABLE','APP_RESTARTED');
  if(stage.reason==='USER_CANCELLED')return match(stage,'ABORTED','USER_CANCELLED');
  if(stage.endOffsetMs>rules.maxElapsedMs)return match(stage,'ABORTED','TIME_LIMIT');
  if(plan.missionCode==='NO_STOP_RAMP' && m.stopCount!==null && m.stopCount>0)return match(stage,'ABORTED','STOPPED');
  if(!stage.segmentEntered || !stage.segmentExited || m.movingDurationMs===null || m.movingDurationMs<=0 || m.maxSpeedKph===0 || (plan.missionCode==='ONE_SHOT_REVERSE' && (stage.parkingConfirmed!==true || m.movingDurationMs>=duration)))return match(stage,'UNVERIFIABLE','SIGNAL_QUALITY');
  if(plan.missionCode==='NO_STOP_RAMP' && m.stopCount===0 && m.movingDurationMs!==duration)reject('INVALID_MOVEMENT_DURATION');
  const count=m[metric]!;
  const stars=plan.missionCode==='NO_STOP_RAMP'?(count===0?rules.scoring.noStopStars:0):plan.missionCode==='ONE_SHOT_REVERSE'?(count===1?rules.scoring.oneReverseStars:0):Math.max(0,rules.scoring.smoothMaxStars-count);
  match(stage,stars>0?'SUCCESS':'FAILED','FINISHED',stars);
}
export function validateRunResult(plans:StagePlan[],rules:MissionRules,startedAt:Date,dto:RunResultDto,now=new Date()) {
  const finishedAt=new Date(dto.finishedAt);
  if(finishedAt.getTime()<startedAt.getTime() || finishedAt.getTime()>now.getTime()+300000 || now.getTime()-finishedAt.getTime()>72*3600000 || Math.abs(finishedAt.getTime()-startedAt.getTime()-dto.elapsedMs)>rules.clockToleranceMs)reject('INVALID_RUN_TIME');
  if(dto.stages.length>plans.length)reject('INVALID_STAGE_REFERENCE');
  let end=0;
  for(const [i,stage]of dto.stages.entries()){
    if(stage.startOffsetMs<end || stage.endOffsetMs>dto.elapsedMs || (i<dto.stages.length-1 && ['ABORTED','UNVERIFIABLE'].includes(stage.outcome)))reject('INVALID_STAGE_ORDER');
    validateStage(plans[i]!,stage,rules);end=stage.endOffsetMs;
  }
  const last=dto.stages.at(-1);
  if(dto.outcome==='COMPLETED'){
    if(dto.stages.length!==plans.length || dto.reason!=='FINISHED' || dto.stages.some(s=>!['SUCCESS','FAILED'].includes(s.outcome)) || dto.elapsedMs>rules.maxElapsedMs || dto.stars!==dto.stages.reduce((n,s)=>n+s.stars,0))reject();
  }else{
    if(dto.stars!==0)reject('RUN_STARS_MISMATCH');
    const early=dto.stages.length===0 && ((dto.outcome==='ABORTED' && ['USER_CANCELLED','UX_RESTRICTED'].includes(dto.reason)) || (dto.outcome==='UNVERIFIABLE' && ['APP_RESTARTED','UX_UNKNOWN','SIGNAL_QUALITY'].includes(dto.reason)));
    const timeout=dto.outcome==='ABORTED' && dto.reason==='TIME_LIMIT' && dto.elapsedMs>rules.maxElapsedMs && (!last || ['SUCCESS','FAILED'].includes(last.outcome));
    if(!early && !timeout && (!last || last.outcome!==dto.outcome || last.reason!==dto.reason))reject('RUN_OUTCOME_MISMATCH');
  }
  return {outcome:dto.outcome,reason:dto.reason,stars:dto.stars,consistencyStatus:'CHECKED' as const,recognitionStatus:'SYNTHETIC_NOT_ELIGIBLE' as const,physicalVerification:'UNVERIFIED' as const,operationalBlockers:['D-02','D-04'],rankingEligible:false,rewardEligible:false};
}
