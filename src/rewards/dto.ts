import {IsIn,IsInt,IsUUID,Matches,Max,Min} from 'class-validator';
export class PrepareSettlementDto {@Matches(/^20\d{2}-(0[1-9]|1[0-2])$/) sourceMonth!:string;@IsIn(['rewards-sandbox-v1']) policyVersion!:'rewards-sandbox-v1';}
export class RewardBatchDto {@IsInt() @Min(1) @Max(20) limit!:number;}
export class CouponHoldDto {@IsUUID() paymentOrderId!:string;}
export class CouponActionDto {@IsIn(['USER_REQUEST']) reason!:'USER_REQUEST';}
