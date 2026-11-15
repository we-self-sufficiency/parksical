import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readConfig} from '../../src/config.js';
import {couponLimits,selectRewardCandidates,settlementBounds,type RewardCandidate} from '../../src/rewards/rules.js';
test('reward selection is stable, at most two distinct lots per source-month user, never two cohorts of the same lot',()=>{
 const c=(lotId:string,cohortKey='a'):RewardCandidate=>({userId:'user',lotId,cohortKey,runId:lotId+cohortKey,snapshotId:'snapshot',score:3,rank:1,passActive:true});
 const input=[c('c'),c('b'),c('a','b'),c('a','a')],expected=selectRewardCandidates(input);assert.deepEqual(expected.map(x=>[x.lotId,x.slot]),[['a',1],['b',2]]);assert.deepEqual(selectRewardCandidates([...input].reverse()),expected);
});
test('cohort ties remain firsts; lower score, non-pass and runner-up never qualify or replace a removed frozen winner',()=>{
 const c:RewardCandidate={userId:'a',lotId:'lot',cohortKey:'c',runId:'r',snapshotId:'s',score:3,rank:1,passActive:true};assert.equal(selectRewardCandidates([c,{...c,userId:'b'}]).length,2);for(const patch of [{score:2},{rank:2},{passActive:false}])assert.equal(selectRewardCandidates([{...c,...patch}]).length,0);
});
test('KST month boundary is separate from exclusive 72-hour ranking cutoff and pass instant',()=>{
 const b=settlementBounds('2026-12');assert.equal(b.endsAt,'2026-12-31T15:00:00.000Z');assert.equal(b.cutoffAt,'2027-01-03T15:00:00.000Z');assert.equal(b.eligibilityAt,'2026-12-31T14:59:59.999Z');assert.throws(()=>settlementBounds('2026-13'));
});
test('synthetic coupon coverage is bounded to whole prepaid value/time, never zero or an unlimited promise',()=>{
 couponLimits(5000,120,5000,120);for(const [amount,minutes]of [[0,30],[5001,30],[1000,121],[1000,0]])assert.throws(()=>couponLimits(amount!,minutes!,5000,120));
});
test('rewards default OFF and require all synthetic dependencies, explicit mailbox; real rewards/notifications are blocked',()=>{
 const env={NODE_ENV:'test',DATABASE_URL:'postgresql://local:local@127.0.0.1/db',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'synthetic-development-secret-00000001',DEV_PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'SANDBOX',PAYMENT_WEBHOOK_SECRET:'synthetic-webhook-secret-000000000001',DEV_SUBSCRIPTIONS_ENABLED:'true',DEV_RANKINGS_ENABLED:'true',REWARD_NOTIFICATION_PROVIDER:'SANDBOX'};
 assert.equal(readConfig(env).devRewardsEnabled,false);assert.equal(readConfig({...env,DEV_REWARDS_ENABLED:'true'}).devRewardsEnabled,true);
 for(const patch of [{NODE_ENV:'production'},{DEV_PAYMENTS_ENABLED:'false'},{DEV_SUBSCRIPTIONS_ENABLED:'false'},{DEV_RANKINGS_ENABLED:'false'},{REWARD_NOTIFICATION_PROVIDER:'BLUELINK'},{REAL_REWARDS_ENABLED:'true'},{REAL_COUPONS_ENABLED:'true'},{REAL_NOTIFICATIONS_ENABLED:'true'}])assert.throws(()=>readConfig({...env,DEV_REWARDS_ENABLED:'true',...patch}));
});
