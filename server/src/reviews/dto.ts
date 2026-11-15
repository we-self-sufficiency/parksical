import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';
export type ReviewRating='EASY'|'NORMAL'|'HARD';
export class ReviewCreateDto {
  @IsUUID() lotId!: string;
  @IsInt() @Min(1) @Max(2147483647) lotVersion!: number;
  @IsUUID() visitId!: string;
  @IsIn(['EASY','NORMAL','HARD']) rating!: ReviewRating;
}
export class ReviewVersionDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
}
export class ReviewUpdateDto extends ReviewVersionDto {
  @IsIn(['EASY','NORMAL','HARD']) rating!: ReviewRating;
}
export class ReviewLookupQuery {
  @IsUUID() lotId!: string;
  @Transform(({value}: {value:unknown})=>typeof value==='string' && /^\d{1,10}$/.test(value)?Number(value):value) @IsInt() @Min(1) @Max(2147483647) lotVersion!: number;
}
export class AggregateQuery {
  @ValidateIf(o=>o.lotVersion!==undefined) @Transform(({value}: {value:unknown})=>typeof value==='string' && /^\d{1,10}$/.test(value)?Number(value):value) @IsInt() @Min(1) @Max(2147483647) lotVersion?: number;
}
export class ReviewRebuildDto {
  @IsIn(['reviews-v1']) ruleVersion!: 'reviews-v1';
}
