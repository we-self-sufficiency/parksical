import { ApiError } from '../api-error.js';
export const subscriptionProduct={code:'MAX_PASS',priceVersion:'max-pass-4900-v1',policyVersion:'subscriptions-v1',amountKrw:4900,currency:'KRW',period:'CALENDAR_MONTH_KST'} as const;
export const subscriptionBoundary={source:'SYNTHETIC',operationalAllowed:false,realPaymentVerified:false,rewardEligible:false,operationalBlockers:['D-05']} as const;
const KST=9*3600000;
// Always calculate from the original anchor: Jan31 -> Feb28 -> Mar31, never drift to Mar28.
export function monthBoundary(anchor:Date,index:number):Date {
  if(!Number.isInteger(index) || index<0 || index>1000 || !Number.isFinite(anchor.getTime()))throw new ApiError(422,'INVALID_SUBSCRIPTION_CYCLE');
  const local=new Date(anchor.getTime()+KST),month=local.getUTCMonth()+index,year=local.getUTCFullYear();
  const day=Math.min(local.getUTCDate(),new Date(Date.UTC(year,month+1,0)).getUTCDate());
  return new Date(Date.UTC(year,month,day,local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds(),local.getUTCMilliseconds())-KST);
}
export function coverageAt(cycle:{startsAt:Date;endsAt:Date;paidAt:Date|null;revokedAt:Date|null},at:Date){return !!cycle.paidAt && cycle.paidAt<=at && cycle.startsAt<=at && at<cycle.endsAt && (!cycle.revokedAt || at<cycle.revokedAt);}
export function renewalWindow(endsAt:Date,now:Date){if(now.getTime()<endsAt.getTime()-300000 || now.getTime()>=endsAt.getTime()+300000)throw new ApiError(409,'SUBSCRIPTION_RENEWAL_WINDOW_CLOSED');}
