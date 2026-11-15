import 'reflect-metadata';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {createApp} from '../../src/app.js';
import {ApiError} from '../../src/api-error.js';
import {readConfig} from '../../src/config.js';
import {DatabaseService} from '../../src/database.service.js';
import {PAYMENT_PROVIDER,signWebhook,type PaymentProvider} from '../../src/payments/provider.js';
import {SubscriptionClock} from '../../src/subscriptions/clock.js';
import {SubscriptionService} from '../../src/subscriptions/subscription.service.js';

test('real PG subscriptions: verified S-16 billing, calendar renewals, bounded rights, cancellation/refund history, replay, rollback and expiry',async()=>{
 execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
 const key='synthetic-subscription-development-000001',secret='synthetic-subscription-webhook-00000001',prefix=randomUUID(),users:string[]=[],installs:string[]=[],logs:Record<string,string|number>[]=[];
 const env={...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key,DEV_PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'SANDBOX',PAYMENT_WEBHOOK_SECRET:secret,DEV_SUBSCRIPTIONS_ENABLED:'true',DEV_RESERVATIONS_ENABLED:'true',DEV_RANKINGS_ENABLED:'true',DEV_MISSIONS_ENABLED:'true'};
 const app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');const base=await app.getUrl();
 const other=await createApp(readConfig(env),r=>logs.push(r));await other.listen(0,'127.0.0.1');const base2=await other.getUrl();
 let now=new Date('2027-01-31T03:00:00.000Z');for(const a of [app,other])a.get(SubscriptionClock).now=async()=>new Date(now);
 const db=app.get(DatabaseService).client,provider=app.get<PaymentProvider>(PAYMENT_PROVIDER),capture=provider.capture.bind(provider),subscriptions=app.get(SubscriptionService);
 type Token={userId:string;accessToken:string};type Cycle={id:string;cycleIndex:number;startsAt:string;endsAt:string;paymentOrderId:string;paymentState:string;paidAt:string|null;revokedAt:string|null};type Sub={id:string;state:string;renewalEnabled:boolean;latestCycle:Cycle};type Ent={syntheticPassActive:boolean;rewardEligible:boolean;operationalAllowed:boolean;evidenceCycleIds:string[]};
 const request=(path:string,t?:Token,method='GET',body?:unknown,idem?:string,origin=base)=>fetch(origin+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(t?{Authorization:'Bearer '+t.accessToken}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const responses:{path:string;status:number;body:unknown}[]=[];
 async function json<T>(r:Response,status=200):Promise<T>{assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');const body=await r.json() as T;if(/\/api\/v1\/(subscriptions|me\/entitlements|payments)/.test(new URL(r.url).pathname))responses.push({path:new URL(r.url).pathname,status,body});return body;}
 async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
 async function login(label:string){const t=await json<Token>(await request('/auth/development/login',undefined,'POST',{subject:prefix+label}));users.push(t.userId);return t;}
 const input={priceVersion:'max-pass-4900-v1',policyVersion:'subscriptions-v1'};
 const join=(t:Token,k=randomUUID(),origin=base)=>request('/subscriptions',t,'POST',input,k,origin);
 const pay=(t:Token,c:Cycle,k=randomUUID(),outcome='SUCCEEDED')=>request('/payments/'+c.paymentOrderId+'/attempts',t,'POST',{sandboxOutcome:outcome},k);
 const stop=(t:Token,s:Sub,k=randomUUID(),origin=base)=>request('/subscriptions/'+s.id+'/cancel',t,'POST',{reason:'USER_REQUEST'},k,origin);
 const recover=(t:Token,c:Cycle)=>request('/payments/'+c.paymentOrderId+'/reconcile',t,'POST',{action:'RECOVER'},randomUUID());
 const renew=(t:Token,s:Sub,index:number,k=randomUUID(),origin=base)=>request('/subscriptions/'+s.id+'/renewals',t,'POST',{expectedCycleIndex:index},k,origin);
 async function rights(t:Token){return json<Ent>(await request('/me/entitlements',t));}
 async function view(t:Token,s:Sub){return json<Sub>(await request('/subscriptions/'+s.id,t));}
 const webhook=async(event:Record<string,unknown>,origin=base)=>{const raw=Buffer.from(JSON.stringify(event)),timestamp=String(Math.floor(Date.now()/1000));return fetch(origin+'/api/v1/payments/webhooks/sandbox',{method:'POST',headers:{'Content-Type':'application/json','X-Payment-Timestamp':timestamp,'X-Payment-Signature':signWebhook(secret,timestamp,raw)},body:raw});};
 try{
  const alice=await login('alice'),bob=await login('bob'),charlie=await login('charlie'),admin=await login('admin');await db.user.update({where:{id:admin.userId},data:{role:'ADMIN'}});
  const pair=await json<{installationId:string;userCode:string;deviceCode:string}>(await request('/auth/vehicle-links',undefined,'POST',{}),201);installs.push(pair.installationId);await json(await request('/auth/vehicle-links/approve',alice,'POST',{userCode:pair.userCode}));const vehicle=await json<Token>(await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:pair.deviceCode}));
  await json(await request('/subscriptions/products',alice));assert.equal((await rights(alice)).syntheticPassActive,false);await error(await request('/subscriptions/products'),401);
  await json(await request('/subscriptions/me',alice));
  const lotId=randomUUID(),quote={lotId,startsAt:new Date(Date.now()+86400000).toISOString(),durationMinutes:30,mode:'PRACTICE',lengthMm:4800,widthMm:1850};
  const run={contractVersion:'1.0',clientRunId:'gate',vehicleSessionId:randomUUID(),lotId,structureVersion:1,ruleVersion:'missions-v1',source:'SYNTHETIC',mode:'CHALLENGE',startedAt:new Date().toISOString(),stageIds:['ONE_SHOT_REVERSE:synthetic']};
  await error(await request('/reservation-quotes',alice,'POST',quote,randomUUID()),403,'SYNTHETIC_PASS_REQUIRED');await error(await request('/runs',vehicle,'POST',run,randomUUID()),403,'SYNTHETIC_PASS_REQUIRED');await error(await request('/rankings/'+lotId+'/cohorts?month=2027-01',alice),403,'SYNTHETIC_PASS_REQUIRED');
  await json(await request('/practice/awards',alice));await json(await request('/me/ranking-consent',alice));
  for(const patch of [{amountKrw:1},{userId:bob.userId},{active:true},{priceVersion:'free'},{startsAt:now.toISOString()}])await error(await request('/subscriptions',alice,'POST',{...input,...patch},randomUUID()),400);
  const keyJoin=randomUUID(),race=await Promise.all([join(alice,keyJoin),join(alice,keyJoin,base2)]),sub=await json<Sub>(race[0]!,201);assert.deepEqual(await json(race[1]!,201),sub);assert.equal(sub.state,'PENDING');assert.equal(sub.latestCycle.endsAt,'2027-02-28T03:00:00.000Z');assert.equal((await rights(alice)).syntheticPassActive,false);
  assert.equal((await json<Sub>(await join(alice),201)).id,sub.id);assert.equal(await db.subscriptionCycle.count({where:{subscriptionId:sub.id}}),1);
  for(const outsider of [bob,admin]){await error(await request('/subscriptions/'+sub.id,outsider),404);await error(await stop(outsider,sub),404);await error(await request('/payments/'+sub.latestCycle.paymentOrderId,outsider),404);}
  now=new Date(now.getTime()+60000);const payKey=randomUUID();await json(await pay(alice,sub.latestCycle,payKey),201);assert.equal((await rights(alice)).syntheticPassActive,true);assert.equal((await rights(alice)).rewardEligible,false);assert.equal((await rights(alice)).operationalAllowed,false);
  await json(await request('/payments/'+sub.latestCycle.paymentOrderId+'/receipt',alice));
  await json(await request('/subscriptions/me',alice));
  assert.equal((await subscriptions.eligibilityAt(alice.userId,new Date('2027-01-31T03:00:59.999Z'))).syntheticPassActive,false);assert.equal((await subscriptions.eligibilityAt(alice.userId,now)).syntheticPassActive,true);
  await error(await request('/reservation-quotes',alice,'POST',quote,randomUUID()),404);await error(await request('/runs',vehicle,'POST',run,randomUUID()),404);await error(await request('/rankings/'+lotId+'/cohorts?month=2027-01',alice),404);
  await error(await renew(alice,sub,0),409,'SUBSCRIPTION_RENEWAL_WINDOW_CLOSED');
  now=new Date('2027-02-28T02:59:00.000Z');const renewed=await Promise.all([renew(alice,sub,0,randomUUID()),renew(alice,sub,0,randomUUID(),base2)]),cycle=(await json<{cycle:Cycle}>(renewed[0]!,201)).cycle;assert.deepEqual((await json<{cycle:Cycle}>(renewed[1]!,201)).cycle,cycle);assert.equal(cycle.endsAt,'2027-03-31T03:00:00.000Z');
  await json(await pay(alice,cycle),201);
  now=new Date('2027-02-28T02:59:30.000Z');await json(await request('/payments/'+sub.latestCycle.paymentOrderId+'/cancel',alice,'POST',{reason:'USER_REQUEST'},randomUUID()),201);await json(await recover(alice,sub.latestCycle),201);assert.equal((await rights(alice)).syntheticPassActive,false);assert.equal((await view(alice,sub)).state,'SCHEDULED');
  now=new Date('2027-02-28T03:00:00.000Z');assert.deepEqual((await rights(alice)).evidenceCycleIds,[cycle.id]);
  const stopKey=randomUUID(),stopped=await json<Sub>(await stop(alice,sub,stopKey),201);assert.equal(stopped.state,'CANCEL_AT_PERIOD_END');assert.equal((await rights(alice)).syntheticPassActive,true);assert.deepEqual(await json(await stop(alice,sub,stopKey),201),stopped);await error(await renew(alice,sub,1),409,'SUBSCRIPTION_RENEWAL_CANCELLED');
  now=new Date('2027-02-28T03:01:00.000Z');await json(await request('/payments/'+cycle.paymentOrderId+'/cancel',alice,'POST',{reason:'USER_REQUEST'},randomUUID()),201);assert.equal((await rights(alice)).syntheticPassActive,false);
  assert.equal((await subscriptions.eligibilityAt(alice.userId,new Date('2027-02-28T03:00:59.999Z'))).syntheticPassActive,true);await json(await recover(alice,cycle),201);assert.equal((await view(alice,sub)).state,'REFUNDED');
  const providerCycle=await provider.lookup(cycle.paymentOrderId),evt={eventId:randomUUID(),orderId:cycle.paymentOrderId,transactionId:providerCycle!.transactionId,amountKrw:4900,currency:'KRW',status:'SUCCEEDED'};await json(await webhook(evt),201);await json(await webhook({...evt,eventId:randomUUID(),status:'FAILED'}),201);assert.equal((await rights(alice)).syntheticPassActive,false);
  await json(await request('/subscriptions/'+sub.id+'/history?limit=2',alice));await error(await request('/me/entitlements?at=2027-01-31',alice),400);
  const failed=await json<Sub>(await join(alice),201);await json(await pay(alice,failed.latestCycle,randomUUID(),'FAILED'),201);assert.equal((await view(alice,failed)).state,'PAYMENT_FAILED');assert.equal((await rights(alice)).syntheticPassActive,false);
  // Cancellation wins while verified capture is in flight; late approval is compensation, never coverage.
  const late=await json<Sub>(await join(alice),201);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});provider.capture=async(...args)=>{const r=await capture(...args);entered();await gate;return r;};const flight=pay(alice,late.latestCycle);await started;await json(await stop(alice,late,randomUUID(),base2),201);release();assert.equal((await json<{state:string}>(await flight,201)).state,'REFUND_PENDING');provider.capture=capture;assert.equal((await rights(alice)).syntheticPassActive,false);await json(await recover(alice,late.latestCycle),201);
  // Lost capture response is completed only by signed provider verification and independent lookup.
  const b=await json<Sub>(await join(bob),201);provider.capture=async(...args)=>{await capture(...args);throw new ApiError(503,'SYNTHETIC_RESPONSE_LOSS');};const lostKey=randomUUID();await error(await pay(bob,b.latestCycle,lostKey),503);provider.capture=capture;now=new Date(now.getTime()+60000);const pb=await provider.lookup(b.latestCycle.paymentOrderId),be={eventId:randomUUID(),orderId:b.latestCycle.paymentOrderId,transactionId:pb!.transactionId,currency:'KRW',amountKrw:4900,status:'SUCCEEDED'};
  const events=await Promise.all([webhook(be),webhook(be,base2)]);assert.deepEqual(await json(events[0]!,201),await json(events[1]!,201));assert.equal((await rights(bob)).syntheticPassActive,true);await json(await pay(bob,b.latestCycle,lostKey),201);assert.equal(await db.subscriptionChange.count({where:{cycleId:b.latestCycle.id,kind:'PAYMENT_SUCCEEDED'}}),1);
  // Receipt/projection failure rolls back payment, entitlement and history together, after provider success.
  const c=await json<Sub>(await join(charlie),201);await db.$executeRawUnsafe(`CREATE FUNCTION test_subscription_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='PAYMENT_SUCCEEDED' THEN RAISE EXCEPTION 'synthetic projection failure';END IF;RETURN NEW;END $$`);await db.$executeRawUnsafe('CREATE TRIGGER test_subscription_failure BEFORE INSERT ON "SubscriptionChange" FOR EACH ROW EXECUTE FUNCTION test_subscription_failure()');const rollbackKey=randomUUID();await error(await pay(charlie,c.latestCycle,rollbackKey),500);assert.equal((await db.subscriptionCycle.findUniqueOrThrow({where:{id:c.latestCycle.id}})).paidAt,null);assert.equal((await db.paymentOrder.findUniqueOrThrow({where:{id:c.latestCycle.paymentOrderId}})).state,'PENDING');assert.equal(await db.paymentReceipt.count({where:{orderId:c.latestCycle.paymentOrderId}}),0);
  await db.$executeRawUnsafe('DROP TRIGGER test_subscription_failure ON "SubscriptionChange"');await db.$executeRawUnsafe('DROP FUNCTION test_subscription_failure()');await json(await pay(charlie,c.latestCycle,rollbackKey),201);assert.equal((await rights(charlie)).syntheticPassActive,true);
  await assert.rejects(db.subscriptionCycle.update({where:{id:c.latestCycle.id},data:{endsAt:new Date('2030-01-01Z')}}));await assert.rejects(db.subscriptionCycle.update({where:{id:c.latestCycle.id},data:{paidAt:null}}));await assert.rejects(db.paymentOrder.update({where:{id:c.latestCycle.paymentOrderId},data:{subscriptionCycleId:cycle.id}}));
  // No new entitlement survives exclusive expiry or failed renewal; owner history/withdrawal remains accessible.
  now=new Date(b.latestCycle.endsAt);assert.equal((await rights(bob)).syntheticPassActive,false);await error(await request('/rankings/'+lotId+'/cohorts?month=2027-03',bob),403,'SYNTHETIC_PASS_REQUIRED');await json(await request('/me/ranking-consent',bob));await json(await request('/subscriptions/'+b.id+'/history',bob));
  const retryCycle=(await json<{cycle:Cycle}>(await renew(bob,b,0),201)).cycle;await json(await pay(bob,retryCycle,randomUUID(),'FAILED'),201);assert.equal((await rights(bob)).syntheticPassActive,false);
  await db.subscriptionMutation.createMany({data:Array.from({length:4000},(_,n)=>({userId:charlie.userId,key:'quota-'+n,requestHash:'0'.repeat(64),response:{synthetic:true}}))});await json(await stop(charlie,c),201);
  const child=spawn(process.execPath,['dist/main.js'],{env:{...env,PORT:'30517'},stdio:['ignore','pipe','pipe']});let diagnostic='';child.stderr?.on('data',(x:Buffer)=>{diagnostic+=x.toString();});try{let ready=false;for(let n=0;n<60;n++){try{ready=(await fetch('http://127.0.0.1:30517/api/v1/health/ready')).ok;}catch{/* startup */}if(ready)break;await pause(100);}assert.ok(ready,diagnostic);const persisted=await json<Sub>(await request('/subscriptions/'+c.id,charlie,'GET',undefined,undefined,'http://127.0.0.1:30517'));assert.equal(persisted.latestCycle.id,c.latestCycle.id);assert.equal(persisted.latestCycle.paymentState,'SUCCEEDED');}finally{child.kill();}
  await request('/auth/logout',bob,'POST',{});await error(await request('/subscriptions/'+b.id,bob),401);assert.ok(!JSON.stringify(logs).includes(secret));assert.ok(!JSON.stringify(logs).includes(alice.accessToken));
 }finally{
  if(process.env.SUBSCRIPTION_HTTP_CAPTURE)await writeFile(process.env.SUBSCRIPTION_HTTP_CAPTURE,JSON.stringify(responses));provider.capture=capture;
  await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_subscription_failure ON "SubscriptionChange"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_subscription_failure()');
  const orders=await db.paymentOrder.findMany({where:{userId:{in:users}},select:{id:true}});await db.sandboxProviderPayment.deleteMany({where:{orderId:{in:orders.map(o=>o.id)}}});await db.paymentOrder.deleteMany({where:{userId:{in:users}}});await db.paymentMutation.deleteMany({where:{userId:{in:users}}});await db.subscriptionChange.deleteMany({where:{subscription:{userId:{in:users}}}});await db.subscriptionCycle.deleteMany({where:{subscription:{userId:{in:users}}}});await db.subscription.deleteMany({where:{userId:{in:users}}});await db.subscriptionMutation.deleteMany({where:{userId:{in:users}}});
  await db.vehiclePairing.deleteMany({where:{installationId:{in:installs}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.installation.deleteMany({where:{id:{in:installs}}});await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();await other.close();await app.close();
 }
});
