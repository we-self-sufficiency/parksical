import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsISO8601, IsObject, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
import { HoursDto } from '../lots/dto.js';
export type ReservationMode = 'CHALLENGE' | 'PRACTICE';
const integer = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value);
export class ReservationPolicyDto {
  @IsIn(['SYNTHETIC']) source!: 'SYNTHETIC';
  @IsBoolean() active!: boolean;
  @IsInt() @Min(1) @Max(2147483647) structureVersion!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(2) @ArrayUnique() @IsIn(['CHALLENGE', 'PRACTICE'], { each: true }) allowedModes!: ReservationMode[];
  @IsInt() @Min(1) @Max(32) capacity!: number;
  @IsInt() @Min(1000) @Max(10000) maxLengthMm!: number;
  @IsInt() @Min(500) @Max(4000) maxWidthMm!: number;
  @IsArray() @ArrayMaxSize(14) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => HoursDto) hours!: HoursDto[];
  @Matches(/^[A-Za-z0-9_.-]{1,32}$/) safetyRulesVersion!: string;
  @IsInt() @Min(15000) @Max(20000) challengeMultiplierBps!: number;
  @IsInt() @Min(12000) @Max(15000) practiceMultiplierBps!: number;
  @IsInt() @Min(1) @Max(900) quoteSeconds!: number;
  @IsInt() @Min(1) @Max(900) holdSeconds!: number;
}
export class ReservationPolicyWriteDto {
  @IsInt() @Min(0) @Max(1000) expectedVersion!: number;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => ReservationPolicyDto) snapshot!: ReservationPolicyDto;
}
export class ReservationSlotsQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @IsIn(['CHALLENGE', 'PRACTICE']) mode!: ReservationMode;
  @integer() @IsInt() @Min(1000) @Max(10000) lengthMm!: number;
  @integer() @IsInt() @Min(500) @Max(4000) widthMm!: number;
}
export class ReservationQuoteDto {
  @IsUUID() lotId!: string;
  @IsIn(['CHALLENGE', 'PRACTICE']) mode!: ReservationMode;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) startsAt!: string;
  @IsInt() @Min(30) @Max(240) durationMinutes!: number;
  @IsInt() @Min(1000) @Max(10000) lengthMm!: number;
  @IsInt() @Min(500) @Max(4000) widthMm!: number;
}
export class ReservationHoldDto {
  @IsUUID() quoteId!: string;
  @Matches(/^[A-Za-z0-9_.-]{1,32}$/) safetyRulesVersion!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) safetyAgreedAt!: string;
}
export class ReservationCancelDto {
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!: number;
  @IsIn(['USER_REQUEST']) reason!: 'USER_REQUEST';
}
export class ReservationSandboxEventDto {
  @IsIn(['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_SUCCEEDED']) kind!: 'PAYMENT_SUCCEEDED' | 'PAYMENT_FAILED' | 'REFUND_SUCCEEDED';
}
