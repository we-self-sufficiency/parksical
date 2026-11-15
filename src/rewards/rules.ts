import {ApiError} from '../api-error.js';
import {rankingMonth} from '../rankings/rules.js';
export const rewardPolicy={version:'rewards-sandbox-v1',minimumStars:3,maxCouponsPerSourceMonth:2,validDays:30,maxAmountKrw:5000,maxDurationMinutes:120,costBearer:'SYNTHETIC_NO_MONETARY_VALUE',tiePolicy:'ALL_COHORT_FIRSTS_TEST_ONLY',selectionOrder:'LOT_UUID_THEN_COHORT_ASC',passAt:'SOURCE_MONTH_END_MINUS_1MS'} as const;
export const rewardBoundary={source:'SYNTHETIC',operationalAllowed:false,rewardEligible:false,redeemableInProduction:false,operationalBlockers:['D-02','D-04','D-05']} as const;
export function settlementBounds(month:string){const b=rankingMonth(month);return {...b,eligibilityAt:new Date(Date.parse(b.endsAt)-1).toISOString()};}
export interface RewardCandidate {userId:string;lotId:string;cohortKey:string;runId:string;snapshotId:string;score:number;rank:number;passActive:boolean;}
export function selectRewardCandidates(candidates:RewardCandidate[]){
 const ordered=candidates.filter(c=>c.rank===1 && c.score>=rewardPolicy.minimumStars && c.passActive).sort((a,b)=>a.userId.localeCompare(b.userId)||a.lotId.localeCompare(b.lotId)||a.cohortKey.localeCompare(b.cohortKey)||a.runId.localeCompare(b.runId));
 const counts=new Map<string,number>(),lots=new Set<string>();
 return ordered.flatMap(c=>{const count=counts.get(c.userId)??0,key=c.userId+':'+c.lotId;if(count>=2 || lots.has(key))return [];counts.set(c.userId,count+1);lots.add(key);return [{...c,slot:count+1}];});
}
export function couponLimits(amount:number,minutes:number,maxAmount:number,maxMinutes:number){if(amount<1 || amount>maxAmount || minutes<30 || minutes>maxMinutes)throw new ApiError(422,'COUPON_COVERAGE_UNSUPPORTED');}
