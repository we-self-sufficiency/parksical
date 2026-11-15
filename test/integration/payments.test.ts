import 'reflect-metadata';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {test} from 'node:test';
import {setTimeout as pause} from 'node:timers/promises';
import {createApp} from '../../src/app.js';
import {ApiError} from '../../src/api-error.js';
import {readConfig} from '../../src/config.js';
import {DatabaseService} from '../../src/database.service.js';
import type {LotCreateDto} from '../../src/lots/dto.js';
import {writeRevision} from '../../src/lots/store.js';
import {PAYMENT_PROVIDER,signWebhook,type PaymentProvider} from '../../src/payments/provider.js';
import type {ReservationPolicyWriteDto} from '../../src/reservations/dto.js';
import {localDay} from '../../src/reservations/rules.js';

test('real PG payments: verified durable provider, retries/loss, atomic receipts, full refunds, ownership and reservation races',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const prefix=randomUUID(),lotId=randomUUID(),key='synthetic-payment-development-00000001',secret='synthetic-webhook-development-0000001',users:string[]=[],logs:Record<string,string|number>[]=[];
  const env={...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key,DEV_PAYMENTS_ENABLED:'true',PAYMENT_PROVIDER:'SANDBOX',PAYMENT_WEBHOOK_SECRET:secret};
  const app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const other=await createApp(readConfig(env),r=>logs.push(r));await other.listen(0,'127.0.0.1');const base2=await other.getUrl();
  const reservedApp=await createApp(readConfig({...env,DEV_RESERVATIONS_ENABLED:'true'}),r=>logs.push(r));await reservedApp.listen(0,'127.0.0.1');const rb=await reservedApp.getUrl();
  const db=app.get(DatabaseService).client,provider=app.get<PaymentProvider>(PAYMENT_PROVIDER),capture=provider.capture.bind(provider),refund=provider.refund.bind(provider);
  type Token={userId:string;accessToken:string};type Order={id:string;state:string;amountKrw:number;quoteId:string;receiptId:string|null;attempt:{transactionId:string;state:string}|null;refund:{state:string;amountKrw:number}|null};
  const call=(path:string,token?:string,method='GET',body?:unknown,idem?:string,origin=base)=>fetch(origin+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(token?{Authorization:'Bearer '+token}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const responses:{path:string;status:number;body:unknown}[]=[];
  async function json<T>(r:Response,status=200):Promise<T>{assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');const body=await r.json() as T;if(new URL(r.url).pathname.startsWith('/api/v1/payment'))responses.push({path:new URL(r.url).pathname,status,body});return body;}
  async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
  async function login(label:string){const t=await json<Token>(await call('/auth/development/login',undefined,'POST',{subject:prefix+label}));users.push(t.userId);return t;}
  const start=new Date(localDay(new Date(Date.now()+86400000)).date+'T01:00:00.000Z');
  const input={lotId,startsAt:start.toISOString(),durationMinutes:30};
  const create=async(t:Token)=>{const q=await json<{quoteId:string;details:{amountKrw:number}}>(await call('/payment-quotes',t.accessToken,'POST',input,randomUUID()),201);assert.equal(q.details.amountKrw,1000);return json<Order>(await call('/payments',t.accessToken,'POST',{quoteId:q.quoteId},randomUUID()),201);};
  const attempt=(t:Token,o:Order,idem=randomUUID(),origin=base,outcome='SUCCEEDED')=>call('/payments/'+o.id+'/attempts',t.accessToken,'POST',{sandboxOutcome:outcome},idem,origin);
  const cancel=(t:Token,o:Order)=>call('/payments/'+o.id+'/cancel',t.accessToken,'POST',{reason:'USER_REQUEST'},randomUUID());
  const recover=(t:Token,o:Order,idem=randomUUID())=>call('/payments/'+o.id+'/reconcile',t.accessToken,'POST',{action:'RECOVER'},idem);
  const get=(t:Token,o:Order)=>call('/payments/'+o.id,t.accessToken);
  const webhook=async(dto:Record<string,unknown>,sig?:string,raw=Buffer.from(JSON.stringify(dto)))=>{const timestamp=String(Math.floor(Date.now()/1000));return fetch(base+'/api/v1/payments/webhooks/sandbox',{method:'POST',headers:{'Content-Type':'application/json','X-Payment-Timestamp':timestamp,'X-Payment-Signature':sig??signWebhook(secret,timestamp,raw)},body:raw});};
  try{
    const fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto;
    await db.$transaction(async tx=>{await tx.parkingLot.create({data:{id:lotId,code:prefix,currentVersion:1}});await writeRevision(tx,lotId,1,fixture.snapshot);});
    const alice=await login('alice'),bob=await login('bob'),admin=await login('admin');await db.user.update({where:{id:admin.userId},data:{role:'ADMIN'}});
    await error(await call('/payments'),401);
    for(const patch of [{amountKrw:1},{currency:'USD'},{userId:bob.userId},{source:'REAL'},{durationMinutes:'30'}])await error(await call('/payment-quotes',alice.accessToken,'POST',{...input,...patch},randomUUID()),400);
    await error(await call('/payment-quotes',alice.accessToken,'POST',{...input,durationMinutes:45},randomUUID()),422);
    const order=await create(alice);assert.equal(order.state,'CREATED');
    await error(await get(bob,order),404);await error(await get(admin,order),404);await error(await call('/payments/'+order.id+'/receipt',bob.accessToken),404);
    await error(await call('/payments',bob.accessToken,'POST',{quoteId:order.quoteId},randomUUID()),404);
    for(const patch of [{amountKrw:1},{currency:'USD'},{success:true}])await error(await call('/payments/'+order.id+'/attempts',alice.accessToken,'POST',{sandboxOutcome:'SUCCEEDED',...patch},randomUUID()),400);
    const idem=randomUUID(),race=await Promise.all([attempt(alice,order,idem),attempt(alice,order,idem,base2)]),paid=await json<Order>(race[0]!,201);assert.deepEqual(await json(race[1]!,201),paid);
    assert.equal(paid.state,'SUCCEEDED');assert.equal(await db.sandboxProviderPayment.count({where:{orderId:order.id}}),1);assert.equal(await db.paymentReceipt.count({where:{orderId:order.id}}),1);
    const page=await json<{items:Order[]}>(await call('/payments?limit=1',alice.accessToken));assert.ok(page.items.every(o=>o.id===order.id));await error(await call('/payments?userId='+bob.userId,alice.accessToken),400);
    await error(await attempt(alice,order,idem,base,'FAILED'),409,'IDEMPOTENCY_CONFLICT');await error(await attempt(alice,order,randomUUID(),base,'FAILED'),409,'PAYMENT_ATTEMPT_CONFLICT');
    const receipt=await json<{receipt:{transactionId:string}}>(await call('/payments/'+order.id+'/receipt',alice.accessToken));assert.equal(receipt.receipt.transactionId,paid.attempt!.transactionId);
    const event={eventId:randomUUID(),orderId:order.id,transactionId:paid.attempt!.transactionId,status:'SUCCEEDED',currency:'KRW',amountKrw:1000};
    await error(await webhook(event,'0'.repeat(64)),401);await error(await webhook({...event,amountKrw:1}),422);await error(await webhook({...event,currency:'USD'}),400);await error(await webhook({...event,transactionId:randomUUID()}),422);
    const duplicate=await Promise.all([webhook(event),webhook(event)]);assert.deepEqual(await json(duplicate[0]!,201),await json(duplicate[1]!,201));
    await error(await webhook({...event,status:'FAILED'}),409,'PAYMENT_EVENT_CONFLICT');
    assert.equal((await json<Order>(await cancel(alice,order),201)).state,'REFUND_PENDING');
    provider.refund=async(...args)=>{await refund(...args);throw new ApiError(503,'SYNTHETIC_RESPONSE_LOSS');};
    const refundKey=randomUUID();await error(await recover(alice,order,refundKey),503);provider.refund=refund;
    assert.equal((await json<Order>(await recover(alice,order,refundKey),201)).state,'REFUNDED');
    // Old success/failure notifications consult current provider truth and cannot reopen a refunded payment.
    for(const status of ['SUCCEEDED','FAILED','REFUNDED'])await json(await webhook({...event,eventId:randomUUID(),status}),201);
    assert.equal((await json<Order>(await get(alice,order))).state,'REFUNDED');assert.equal(await db.paymentReceipt.count({where:{orderId:order.id}}),1);assert.equal(await db.paymentRefund.count({where:{orderId:order.id}}),1);
    await error(await call('/payments/'+order.id+'/cancel',alice.accessToken,'POST',{reason:'USER_REQUEST',amountKrw:500},randomUUID()),400);
    const lost=await create(alice);provider.capture=async(...args)=>{await capture(...args);throw new ApiError(503,'SYNTHETIC_RESPONSE_LOSS');};
    const lostKey=randomUUID();await error(await attempt(alice,lost,lostKey),503);provider.capture=capture;
    assert.equal((await json<Order>(await get(alice,lost))).state,'PENDING');assert.equal((await json<Order>(await attempt(alice,lost,lostKey),201)).state,'SUCCEEDED');assert.equal(await db.sandboxProviderPayment.count({where:{orderId:lost.id}}),1);
    const failed=await create(alice);assert.equal((await json<Order>(await attempt(alice,failed,randomUUID(),base,'FAILED'),201)).state,'FAILED');await error(await call('/payments/'+failed.id+'/receipt',alice.accessToken),404);await error(await attempt(alice,failed),409);
    const unpaid=await create(alice);assert.equal((await json<Order>(await cancel(alice,unpaid),201)).state,'CANCELLED');await error(await attempt(alice,unpaid),409);assert.equal(await provider.lookup(unpaid.id),null);
    await error(await webhook({...event,eventId:randomUUID(),orderId:unpaid.id}),422,'PAYMENT_PROVIDER_NOT_FOUND');
    const noResponse=await create(alice);provider.capture=async()=>{throw new Error('synthetic provider outage');};
    await error(await attempt(alice,noResponse),503,'PAYMENT_PROVIDER_UNAVAILABLE');provider.capture=capture;
    assert.equal(await provider.lookup(noResponse.id),null);assert.equal((await json<Order>(await recover(alice,noResponse),201)).state,'SUCCEEDED');
    // Provider succeeded but local receipt commit failed: retry reconciles without a second capture.
    const rollback=await create(alice);await db.$executeRawUnsafe(`CREATE FUNCTION test_payment_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt failure'; END $$`);await db.$executeRawUnsafe('CREATE TRIGGER test_payment_failure BEFORE INSERT ON "PaymentReceipt" FOR EACH ROW EXECUTE FUNCTION test_payment_failure()');
    const rollbackKey=randomUUID();await error(await attempt(alice,rollback,rollbackKey),500);assert.equal((await json<Order>(await get(alice,rollback))).state,'PENDING');assert.equal(await db.paymentReceipt.count({where:{orderId:rollback.id}}),0);assert.equal((await provider.lookup(rollback.id))!.status,'SUCCEEDED');
    await db.$executeRawUnsafe('DROP TRIGGER test_payment_failure ON "PaymentReceipt"');await db.$executeRawUnsafe('DROP FUNCTION test_payment_failure()');assert.equal((await json<Order>(await attempt(alice,rollback,rollbackKey),201)).state,'SUCCEEDED');
    await assert.rejects(db.paymentOrder.update({where:{id:rollback.id},data:{amountKrw:1}}));await assert.rejects(db.paymentOrder.update({where:{id:rollback.id},data:{state:'PENDING'}}));await assert.rejects(db.paymentReceipt.update({where:{orderId:rollback.id},data:{body:{}}}));
    // A durable command can be recovered after an external success by an independent compiled API process.
    const child=spawn(process.execPath,['dist/main.js'],{env:{...env,PORT:'30516'},stdio:['ignore','pipe','pipe']});let diagnostic='';child.stderr?.on('data',(b:Buffer)=>{diagnostic+=b.toString();});
    try{let ready=false;for(let n=0;n<60;n++){try{ready=(await fetch('http://127.0.0.1:30516/api/v1/health/ready')).ok;}catch{/* startup */}if(ready)break;await pause(100);}assert.ok(ready,diagnostic);const persisted=await json<Order>(await call('/payments/'+lost.id,alice.accessToken,'GET',undefined,undefined,'http://127.0.0.1:30516'));assert.equal(persisted.attempt!.transactionId,(await json<Order>(await get(alice,lost))).attempt!.transactionId);}finally{child.kill();}
    // Reservations reuse the S-14 immutable price and locks; old direct sandbox commands cannot bypass S-16.
    const policy=JSON.parse(await readFile('fixtures/reservations/synthetic-policy.json','utf8')) as ReservationPolicyWriteDto;
    await json(await call('/admin/lots/'+lotId+'/reservation-policy',admin.accessToken,'PUT',policy,randomUUID(),rb),200);
    type Reservation={id:string;state:string;version:number};
    const held=async(t:Token,hour:number)=>{const q=await json<{quoteId:string;details:{safetyRulesVersion:string}}>(await call('/reservation-quotes',t.accessToken,'POST',{...input,startsAt:new Date(start.getTime()+hour*3600000).toISOString(),mode:'PRACTICE',lengthMm:4800,widthMm:1850},randomUUID(),rb),201);return json<Reservation>(await call('/reservations',t.accessToken,'POST',{quoteId:q.quoteId,safetyRulesVersion:q.details.safetyRulesVersion,safetyAgreedAt:new Date().toISOString()},randomUUID(),rb),201);};
    const bind=async(t:Token,r:Reservation)=>json<Order>(await call('/payments/reservations',t.accessToken,'POST',{reservationId:r.id},randomUUID(),rb),201);
    const r=await held(alice,1),ro=await bind(alice,r);assert.equal(ro.amountKrw,1250);
    await error(await call('/reservations/'+r.id+'/sandbox-events',alice.accessToken,'POST',{kind:'PAYMENT_SUCCEEDED'},randomUUID(),rb),409,'RESERVATION_PAYMENT_ORDER_BOUND');
    assert.equal((await json<Order>(await attempt(alice,ro,randomUUID(),rb),201)).state,'SUCCEEDED');let rv=await json<Reservation>(await call('/reservations/'+r.id,alice.accessToken,'GET',undefined,undefined,rb));assert.equal(rv.state,'SANDBOX_CONFIRMED');
    await json(await call('/reservations/'+r.id+'/cancel',alice.accessToken,'POST',{expectedVersion:rv.version,reason:'USER_REQUEST'},randomUUID(),rb),201);
    assert.equal((await json<Order>(await recover(alice,ro),201)).state,'REFUNDED');rv=await json<Reservation>(await call('/reservations/'+r.id,alice.accessToken,'GET',undefined,undefined,rb));assert.equal(rv.state,'REFUNDED');assert.equal(await db.reservationClaim.count({where:{reservationId:r.id}}),0);
    // Cancel wins while capture response is in flight. Late success goes to refund, never reacquires a slot.
    const rp=reservedApp.get<PaymentProvider>(PAYMENT_PROVIDER),rc=rp.capture.bind(rp);
    const lateReservation=await held(alice,2),late=await bind(alice,lateReservation);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    rp.capture=async(...args)=>{const result=await rc(...args);entered();await gate;return result;};
    const inFlight=attempt(alice,late,randomUUID(),rb);await started;await json(await cancel(alice,late),201);const replacement=await held(bob,2);release();assert.equal((await json<Order>(await inFlight,201)).state,'REFUND_PENDING');rp.capture=rc;
    assert.equal(await db.reservationClaim.count({where:{reservationId:lateReservation.id}}),0);assert.equal(await db.reservationClaim.count({where:{reservationId:replacement.id}}),1);assert.equal((await json<Order>(await recover(alice,late),201)).state,'REFUNDED');
    // Expiration with independently sold capacity follows the same compensation path.
    policy.expectedVersion=1;policy.snapshot.holdSeconds=1;await json(await call('/admin/lots/'+lotId+'/reservation-policy',admin.accessToken,'PUT',policy,randomUUID(),rb),200);
    const expR=await held(alice,3),exp=await bind(alice,expR);let expiryRelease!:()=>void,expiryEntered!:()=>void;const expiryGate=new Promise<void>(resolve=>{expiryRelease=resolve;}),expiryStart=new Promise<void>(resolve=>{expiryEntered=resolve;});
    rp.capture=async(...args)=>{const result=await rc(...args);expiryEntered();await expiryGate;return result;};const expiredFlight=attempt(alice,exp,randomUUID(),rb);await expiryStart;await pause(1100);const sold=await held(bob,3);expiryRelease();assert.equal((await json<Order>(await expiredFlight,201)).state,'REFUND_PENDING');rp.capture=rc;
    assert.equal(await db.reservationClaim.count({where:{reservationId:expR.id}}),0);assert.equal(await db.reservationClaim.count({where:{reservationId:sold.id}}),1);await json(await recover(alice,exp),201);
    // Exhaustion of new command capacity must never block cancellation/full-refund recovery.
    await db.paymentMutation.createMany({data:Array.from({length:4000},(_,n)=>({userId:alice.userId,key:'quota-'+n,requestHash:'0'.repeat(64),response:{synthetic:true}}))});
    await error(await call('/payment-quotes',alice.accessToken,'POST',input,randomUUID()),409,'PAYMENT_COMMAND_LIMIT');
    assert.equal((await json<Order>(await cancel(alice,lost),201)).state,'REFUND_PENDING');assert.equal((await json<Order>(await recover(alice,lost),201)).state,'REFUNDED');
    // Revoked sessions cannot read/retry a transaction; webhook recovery remains provider authenticated.
    const logout=await call('/auth/logout',alice.accessToken,'POST',{});assert.equal(logout.status,204);await error(await get(alice,lost),401);
    assert.ok(!JSON.stringify(logs).includes(secret));assert.ok(!JSON.stringify(logs).includes(alice.accessToken));assert.ok(!JSON.stringify(logs).includes(late.id));
  }finally{
    if(process.env.PAYMENT_HTTP_CAPTURE)await writeFile(process.env.PAYMENT_HTTP_CAPTURE,JSON.stringify(responses));
    provider.capture=capture;provider.refund=refund;
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_payment_failure ON "PaymentReceipt"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_payment_failure()');
    const orders=await db.paymentOrder.findMany({where:{userId:{in:users}},select:{id:true}});await db.sandboxProviderPayment.deleteMany({where:{orderId:{in:orders.map(o=>o.id)}}});await db.paymentOrder.deleteMany({where:{userId:{in:users}}});await db.paymentQuote.deleteMany({where:{userId:{in:users}}});await db.paymentMutation.deleteMany({where:{userId:{in:users}}});
    await db.reservationMutation.deleteMany({where:{userId:{in:users}}});await db.reservation.deleteMany({where:{userId:{in:users}}});await db.reservationQuote.deleteMany({where:{userId:{in:users}}});await db.reservationPolicy.deleteMany({where:{lotId}});
    await db.parkingSpace.deleteMany({where:{lotId}});await db.lotDriveAisle.deleteMany({where:{lotId}});await db.lotPillar.deleteMany({where:{lotId}});await db.lotRamp.deleteMany({where:{lotId}});await db.lotEntrance.deleteMany({where:{lotId}});await db.lotZone.deleteMany({where:{lotId}});await db.lotFloor.deleteMany({where:{lotId}});await db.lotRevision.deleteMany({where:{lotId}});await db.parkingLot.deleteMany({where:{id:lotId}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();
    await reservedApp.close();await other.close();await app.close();
  }
});
