import { IsInt,Matches,Max,Min } from 'class-validator';
export class QrIssueDto {
  @IsInt() @Min(1) @Max(2147483647) expectedVersion!:number;
}
export class QrExchangeDto {
  @Matches(/^[A-Za-z0-9_-]{43}$/) token!:string;
}
