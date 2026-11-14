import { Transform,Type } from 'class-transformer';
import { ArrayMaxSize,ArrayMinSize,ArrayUnique,IsArray,IsBoolean,IsDefined,IsIn,IsInt,IsISO8601,IsNumber,IsObject,IsUUID,Matches,Max,Min,ValidateIf,ValidateNested } from 'class-validator';
export const QUALITY_SIGNALS=['speed','gear','steeringAngle','segment','riskEvents'] as const;
export type QualitySignal=typeof QUALITY_SIGNALS[number];
export const QUALITY_STATUSES=['AVAILABLE','UNSUPPORTED','PERMISSION_DENIED','ERROR','MISSING','STALE','UNKNOWN'] as const;
export const STAGE_REASONS=['FINISHED','SPEED_LIMIT','DANGER_EVENT','UX_RESTRICTED','UX_UNKNOWN','SIGNAL_QUALITY','USER_CANCELLED','APP_RESTARTED','TIME_LIMIT'] as const;
export type StageReason=typeof STAGE_REASONS[number];
export type StageOutcome='SUCCESS'|'FAILED'|'ABORTED'|'UNVERIFIABLE';
const integer=()=>Transform(({value}:{value:unknown})=>typeof value==='string' && /^\d{1,10}$/.test(value)?Number(value):value);
export class MissionQuery {
  @IsUUID() lotId!:string;
  @integer() @IsInt() @Min(1) @Max(2147483647) structureVersion!:number;
  @ValidateIf(o=>o.ruleVersion!==undefined) @Matches(/^[a-z0-9-]{1,32}$/) ruleVersion?:string;
}
export class RunCreateDto {
  @IsIn(['1.0']) contractVersion!:'1.0';
  @Matches(/^[A-Za-z0-9_.-]{1,64}$/) clientRunId!:string;
  @IsUUID() vehicleSessionId!:string;
  @IsUUID() lotId!:string;
  @IsInt() @Min(1) @Max(2147483647) structureVersion!:number;
  @Matches(/^[a-z0-9-]{1,32}$/) ruleVersion!:string;
  @IsIn(['SYNTHETIC']) source!:'SYNTHETIC';
  @IsIn(['CHALLENGE','PRACTICE']) mode!:'CHALLENGE'|'PRACTICE';
  @IsISO8601({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) startedAt!:string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3) @ArrayUnique() @Matches(/^[A-Z_]+:[A-Za-z0-9_-]{1,32}$/,{each:true}) stageIds!:string[];
}
export class SignalQualityDto {
  @IsIn(QUALITY_SIGNALS) signal!:QualitySignal;
  @IsIn(QUALITY_STATUSES) status!:typeof QUALITY_STATUSES[number];
  @IsInt() @Min(0) @Max(1000000) validSampleCount!:number;
  @ValidateIf(o=>o.maxGapMs!==null) @IsInt() @Min(0) @Max(86400000) maxGapMs!:number|null;
  @IsInt() @Min(0) @Max(86400000) coveredMs!:number;
}
export class StageMetricsDto {
  @ValidateIf(o=>o.movingDurationMs!==null) @IsInt() @Min(0) @Max(86400000) movingDurationMs!:number|null;
  @ValidateIf(o=>o.maxSpeedKph!==null) @IsNumber({maxDecimalPlaces:3}) @Min(0) @Max(500) maxSpeedKph!:number|null;
  @ValidateIf(o=>o.dangerEventCount!==null) @IsInt() @Min(0) @Max(10000) dangerEventCount!:number|null;
  @ValidateIf(o=>o.reverseSegmentCount!==null) @IsInt() @Min(0) @Max(10000) reverseSegmentCount!:number|null;
  @ValidateIf(o=>o.stopCount!==null) @IsInt() @Min(0) @Max(10000) stopCount!:number|null;
  @ValidateIf(o=>o.abruptSteeringCount!==null) @IsInt() @Min(0) @Max(10000) abruptSteeringCount!:number|null;
}
export class StageResultDto {
  @Matches(/^[A-Z_]+:[A-Za-z0-9_-]{1,32}$/) stageId!:string;
  @IsInt() @Min(0) @Max(86400000) startOffsetMs!:number;
  @IsInt() @Min(1) @Max(86400000) endOffsetMs!:number;
  @IsIn(['SUCCESS','FAILED','ABORTED','UNVERIFIABLE']) outcome!:StageOutcome;
  @IsIn(STAGE_REASONS) reason!:StageReason;
  @IsInt() @Min(0) @Max(3) stars!:number;
  @IsBoolean() segmentEntered!:boolean;
  @IsBoolean() segmentExited!:boolean;
  @ValidateIf(o=>o.parkingConfirmed!==null) @IsBoolean() parkingConfirmed!:boolean|null;
  @IsIn(['ALLOWED','RESTRICTED','UNKNOWN']) uxState!:'ALLOWED'|'RESTRICTED'|'UNKNOWN';
  @IsDefined() @IsObject() @ValidateNested() @Type(()=>StageMetricsDto) metrics!:StageMetricsDto;
  @IsArray() @ArrayMinSize(4) @ArrayMaxSize(5) @ArrayUnique((v:SignalQualityDto)=>v.signal) @ValidateNested({each:true}) @Type(()=>SignalQualityDto) quality!:SignalQualityDto[];
}
export class RunResultDto {
  @IsInt() @Min(1) @Max(1) expectedVersion!:number;
  @Matches(/^[A-Za-z0-9_.-]{1,64}$/) clientResultId!:string;
  @IsIn(['SYNTHETIC']) source!:'SYNTHETIC';
  @IsIn(['COMPLETED','ABORTED','UNVERIFIABLE']) outcome!:'COMPLETED'|'ABORTED'|'UNVERIFIABLE';
  @IsIn(STAGE_REASONS) reason!:StageReason;
  @IsISO8601({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) finishedAt!:string;
  @IsInt() @Min(0) @Max(86400000) elapsedMs!:number;
  @IsInt() @Min(0) @Max(9) stars!:number;
  @IsArray() @ArrayMaxSize(3) @ArrayUnique((v:StageResultDto)=>v.stageId) @ValidateNested({each:true}) @Type(()=>StageResultDto) stages!:StageResultDto[];
}
export class RunPageQuery {
  @ValidateIf(o=>o.limit!==undefined) @integer() @IsInt() @Min(1) @Max(50) limit?:number;
  @ValidateIf(o=>o.cursor!==undefined) @Matches(/^[A-Za-z0-9_-]{1,256}$/) cursor?:string;
}
