import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
export class PracticeProgressQuery { @IsUUID() runId!: string; }
export class PracticeInvalidateDto {
  @IsInt() @Min(1) @Max(1) expectedVersion!: number;
  @IsIn(['USER_REQUEST', 'CORRECTION']) reason!: 'USER_REQUEST' | 'CORRECTION';
}
