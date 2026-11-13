import type { ReviewRating } from './dto.js';
export const REVIEW_RULE_VERSION='reviews-v1';
export const MIN_REVIEW_SAMPLES=5;
export const RATING_POINTS=Object.freeze({EASY:1,NORMAL:3,HARD:5});
export interface ReviewTotals {scoreSum:bigint;sampleCount:number;version:number;updatedAt:Date;source:string;}
export function reviewAverage(totals:Pick<ReviewTotals,'scoreSum'|'sampleCount'>) {
  if(!Number.isInteger(totals.sampleCount) || totals.sampleCount<0 || totals.sampleCount>2147483647 || totals.scoreSum<BigInt(totals.sampleCount) || totals.scoreSum>BigInt(totals.sampleCount)*5n)throw Error('Invalid review aggregate');
  return totals.sampleCount===0?null:Math.round(Number(totals.scoreSum)*1e6/totals.sampleCount)/1e6;
}
export function sumRatings(ratings:ReviewRating[]) {return ratings.reduce((n,r)=>n+RATING_POINTS[r],0);}
export function reviewEvidence(enabled:boolean,totals?:ReviewTotals|null) {
  const average=enabled && totals?reviewAverage(totals):null;
  if(totals && totals.source!=='SYNTHETIC')throw Error('Unsupported review source');
  const count=enabled?(totals?.sampleCount??0):null;
  return {
    factor:enabled?{score:average,source:'SYNTHETIC' as const,sampleCount:totals?.sampleCount??0}:undefined,
    metadata:{status:!enabled?'DISABLED' as const:!count?'NO_SAMPLES' as const:count<MIN_REVIEW_SAMPLES?'INSUFFICIENT_SAMPLES' as const:'READY' as const,
      source:'SYNTHETIC' as const,privacyStatus:'DEVELOPMENT_ONLY_NOT_ANONYMIZED' as const,ruleVersion:REVIEW_RULE_VERSION,sampleCount:count,
      version:enabled?(totals?.version??null):null,updatedAt:enabled?(totals?.updatedAt.toISOString()??null):null},
    publishedScore:count!==null && count>=MIN_REVIEW_SAMPLES?average:null,
  };
}
