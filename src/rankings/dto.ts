import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsISO8601, Matches, Max, Min, ValidateIf } from 'class-validator';
const integer = () => Transform(({ value }: { value: unknown }) => typeof value === 'string' && /^\d{1,10}$/.test(value) ? Number(value) : value);
export class RankingMonthQuery { @Matches(/^20\d{2}-(0[1-9]|1[0-2])$/) month!: string; }
export class RankingQuery extends RankingMonthQuery { @Matches(/^[a-f0-9]{64}$/) cohortKey!: string; }
export class RankingPageQuery extends RankingQuery {
  @ValidateIf(o => o.limit !== undefined) @integer() @IsInt() @Min(1) @Max(50) limit?: number;
  @ValidateIf(o => o.cursor !== undefined) @Matches(/^[A-Za-z0-9_-]{1,1024}$/) cursor?: string;
}
export class RankingConsentDto {
  @IsInt() @Min(0) @Max(999) expectedVersion!: number;
  @IsIn(['rankings-public-v1']) policyVersion!: 'rankings-public-v1';
  @IsBoolean() enabled!: boolean;
  @ValidateIf(o => o.agreedAt !== null) @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) agreedAt!: string | null;
}
export class RankingRecordMutationDto {
  @IsInt() @Min(1) @Max(2) expectedVersion!: number;
  @IsIn(['USER_REQUEST', 'CORRECTION']) reason!: 'USER_REQUEST' | 'CORRECTION';
}
