import {IsIn,IsInt,Max,Min} from 'class-validator';
export class SubscribeDto {
  @IsIn(['max-pass-4900-v1']) priceVersion!:'max-pass-4900-v1';
  @IsIn(['subscriptions-v1']) policyVersion!:'subscriptions-v1';
}
export class RenewSubscriptionDto {@IsInt() @Min(0) @Max(998) expectedCycleIndex!:number;}
export class CancelSubscriptionDto {@IsIn(['USER_REQUEST']) reason!:'USER_REQUEST';}
