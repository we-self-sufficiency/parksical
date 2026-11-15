import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readConfig} from '../../src/config.js';
import {coverageAt,monthBoundary,renewalWindow,subscriptionProduct} from '../../src/subscriptions/rules.js';
test('subscription calendar months keep original KST anchor, end-of-month clamping and leap days without drift',()=>{
 const anchor=new Date('2026-01-30T15:04:05.006Z');
 assert.equal(monthBoundary(anchor,1).toISOString(),'2026-02-27T15:04:05.006Z');assert.equal(monthBoundary(anchor,2).toISOString(),'2026-03-30T15:04:05.006Z');
 assert.equal(monthBoundary(new Date('2028-01-31T03:00:00.000Z'),1).toISOString(),'2028-02-29T03:00:00.000Z');
 assert.throws(()=>monthBoundary(anchor,-1));assert.throws(()=>monthBoundary(anchor,1.5));assert.equal(subscriptionProduct.amountKrw,4900);
});
test('subscription coverage is verified half-open time, delayed approval never backdates, refund revokes prospectively',()=>{
 const startsAt=new Date('2026-01-01T00:00:00Z'),endsAt=new Date('2026-02-01T00:00:00Z'),paidAt=new Date('2026-01-01T00:01:00Z'),revokedAt=new Date('2026-01-15T00:00:00Z');
 const c={startsAt,endsAt,paidAt,revokedAt};assert.equal(coverageAt({...c,paidAt:null},paidAt),false);assert.equal(coverageAt(c,startsAt),false);assert.equal(coverageAt(c,paidAt),true);assert.equal(coverageAt(c,new Date(revokedAt.getTime()-1)),true);assert.equal(coverageAt(c,revokedAt),false);assert.equal(coverageAt({...c,revokedAt:null},endsAt),false);
});
test('renewal preparation opens five minutes before boundary, closes five minutes after; no entitlement grace',()=>{
 const end=new Date('2026-02-01T00:00:00Z');renewalWindow(end,new Date(end.getTime()-300000));renewalWindow(end,new Date(end.getTime()+299999));assert.throws(()=>renewalWindow(end,new Date(end.getTime()-300001)));assert.throws(()=>renewalWindow(end,new Date(end.getTime()+300000)));
});
test('subscriptions need sandbox payments, default off and never production/real billing',()=>{
 const env={NODE_ENV:'test',DATABASE_URL:'postgresql://local:local@127.0.0.1/db',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'synthetic-development-secret-00000001',DEV_PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'SANDBOX',PAYMENT_WEBHOOK_SECRET:'synthetic-webhook-secret-000000000001'};
 assert.equal(readConfig(env).devSubscriptionsEnabled,false);assert.equal(readConfig({...env,DEV_SUBSCRIPTIONS_ENABLED:'true'}).devSubscriptionsEnabled,true);
 for(const patch of [{NODE_ENV:'production'},{DEV_PAYMENTS_ENABLED:'false'},{DEV_AUTH_ENABLED:'false'},{REAL_SUBSCRIPTIONS_ENABLED:'true'},{DEV_SUBSCRIPTIONS_ENABLED:'yes'}])assert.throws(()=>readConfig({...env,DEV_SUBSCRIPTIONS_ENABLED:'true',...patch}));
});
