import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsInt, IsISO8601, IsObject, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export const SIGNALS = ['gear', 'speed', 'steeringAngle', 'brake', 'safetyWarnings', 'carProfile', 'navigation'] as const;
export type Signal = typeof SIGNALS[number];
export type CapabilityStatus = 'SUPPORTED' | 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'ERROR' | 'UNKNOWN';
export class CapabilityDto {
  @IsIn(['SUPPORTED', 'UNSUPPORTED', 'PERMISSION_DENIED', 'ERROR', 'UNKNOWN']) status!: CapabilityStatus;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) checkedAt!: string;
}
export class CapabilitiesDto {
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) gear!: CapabilityDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) speed!: CapabilityDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) steeringAngle!: CapabilityDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) brake!: CapabilityDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) safetyWarnings!: CapabilityDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) carProfile!: CapabilityDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilityDto) navigation!: CapabilityDto;
}
export class VehicleSessionDto {
  @IsString() @MinLength(1) @MaxLength(16) contractVersion!: string;
  @IsString() @MinLength(1) @MaxLength(32) appVersion!: string;
  @IsUUID() installationId!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => CapabilitiesDto) capabilities!: CapabilitiesDto;
  @ValidateIf(o => o.reportedSource !== undefined) @IsIn(['SYNTHETIC', 'APP_REPORTED']) reportedSource?: 'SYNTHETIC' | 'APP_REPORTED';
}
export class ClosePayloadDto {
  @IsIn(['USER_ENDED', 'APP_STOPPED']) reason!: 'USER_ENDED' | 'APP_STOPPED';
}
export class VehicleEventDto {
  @IsString() @MinLength(1) @MaxLength(16) contractVersion!: string;
  @Matches(/^[A-Za-z0-9_.-]{1,64}$/) eventId!: string;
  @IsInt() @Min(1) @Max(2147483647) sequence!: number;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) occurredAt!: string;
  @IsIn(['CAPABILITIES_REPORTED', 'SESSION_CLOSED']) type!: 'CAPABILITIES_REPORTED' | 'SESSION_CLOSED';
  @IsDefined() @IsObject() @ValidateNested()
  @Type(options => (options?.object as { type?: string })?.type === 'CAPABILITIES_REPORTED' ? CapabilitiesDto : ClosePayloadDto)
  payload!: CapabilitiesDto | ClosePayloadDto;
}
