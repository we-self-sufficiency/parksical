import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { DifficultyQueryDto } from '../difficulty/dto.js';

const coordinate = () => Transform(({value}: {value:unknown}) => typeof value==='string' && /^-?\d{1,3}(?:\.\d{1,7})?$/.test(value) ? Number(value) : value);
const integer = () => Transform(({value}: {value:unknown}) => typeof value==='string' && /^\d{1,5}$/.test(value) ? Number(value) : value);
export class LotSearchQuery extends DifficultyQueryDto {
  @coordinate() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @coordinate() @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ValidateIf(o=>o.radiusM!==undefined) @integer() @IsInt() @Min(1) @Max(20000) radiusM?: number;
  @ValidateIf(o=>o.south!==undefined) @coordinate() @IsNumber() @Min(-90) @Max(90) south?: number;
  @ValidateIf(o=>o.north!==undefined) @coordinate() @IsNumber() @Min(-90) @Max(90) north?: number;
  @ValidateIf(o=>o.west!==undefined) @coordinate() @IsNumber() @Min(-180) @Max(180) west?: number;
  @ValidateIf(o=>o.east!==undefined) @coordinate() @IsNumber() @Min(-180) @Max(180) east?: number;
  @ValidateIf(o=>o.limit!==undefined) @integer() @IsInt() @Min(1) @Max(50) limit?: number;
  @ValidateIf(o=>o.sort!==undefined) @IsIn(['DISTANCE','EASIEST']) sort?: 'DISTANCE'|'EASIEST';
  @ValidateIf(o=>o.ownership!==undefined) @IsIn(['PUBLIC','PRIVATE','UNKNOWN']) ownership?: string;
  @ValidateIf(o=>o.partnered!==undefined) @Transform(({value}: {value:unknown})=>value==='true'?true:value==='false'?false:value) @IsBoolean() partnered?: boolean;
  @ValidateIf(o=>o.discountCode!==undefined) @Matches(/^[A-Z0-9_]{1,32}$/) discountCode?: string;
  @ValidateIf(o=>o.cursor!==undefined) @IsString() @MaxLength(512) cursor?: string;
}
export class LotDetailQuery extends DifficultyQueryDto {}
