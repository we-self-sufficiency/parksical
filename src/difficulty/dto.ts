import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import type { VehicleStatus } from './calculator.js';

const decimal = () => Transform(({value}: {value:unknown})=>typeof value==='string' && /^\d{1,5}$/.test(value) ? Number(value) : value);
export class DifficultyQueryDto {
  @ValidateIf(o=>o.vehicleLengthMm!==undefined) @decimal() @IsInt() @Min(1000) @Max(10000) vehicleLengthMm?: number;
  @ValidateIf(o=>o.vehicleWidthMm!==undefined) @decimal() @IsInt() @Min(500) @Max(4000) vehicleWidthMm?: number;
  @ValidateIf(o=>o.vehicleStatus!==undefined) @IsIn(['SUPPORTED','UNSUPPORTED','PERMISSION_DENIED','ERROR','UNKNOWN']) vehicleStatus?: VehicleStatus;
  @ValidateIf(o=>o.asOfYear!==undefined) @decimal() @IsInt() @Min(2000) @Max(2200) asOfYear?: number;
  @ValidateIf(o=>o.lotVersion!==undefined) @Transform(({value}: {value:unknown})=>typeof value==='string' && /^\d{1,10}$/.test(value)?Number(value):value) @IsInt() @Min(1) @Max(2147483647) lotVersion?: number;
  @ValidateIf(o=>o.ruleVersion!==undefined) @IsString() @MinLength(1) @MaxLength(32) ruleVersion?: string;
}
