import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { test } from 'node:test';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';

interface Tokens { sessionId: string; userId: string; accessToken: string; refreshToken: string; }
interface Pair { installationId: string; installationSecret: string; deviceCode: string; userCode: string; }
interface Receipt { eventId: string; disposition: string; lastAppliedSequence: number; }
const devKey = 'synthetic-vehicle-testing-only-key-000000001';

test('vehicle receipt durability, validation, ownership, offline order, revocation and independent process restart', async context => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  const records: Record<string, string | number>[] = [];
  const env = { ...process.env, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: devKey };
  const app = await createApp(readConfig(env), r => records.push(r));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(DatabaseService).client;
  const users = new Set<string>(), installations = new Set<string>();
  const prefix = 'vehicle_' + randomUUID();
  const privateValues: string[] = [devKey];
  let child: ChildProcess | undefined;
  const now = Date.now();
  function caps(offset = 0, status = 'SUPPORTED') {
    return Object.fromEntries(['gear','speed','steeringAngle','brake','safetyWarnings','carProfile','navigation'].map(k => [k, { status, checkedAt: new Date(now + offset).toISOString() }]));
  }
  const call = (path: string, body: unknown, token?: string, key?: string, host = base, method = 'POST') => fetch(host + '/api/v1' + path, { method, headers: {
    'content-type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
  }, body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body) });
  async function code(response: Response, status: number, expected: string) {
    assert.equal(response.status, status);
    assert.equal((await response.json() as { error: { code: string } }).error.code, expected);
  }
  async function login(suffix: string) {
    const res = await fetch(base + '/api/v1/auth/development/login', { method: 'POST', headers: { 'content-type':'application/json','X-Development-Key':devKey },body:JSON.stringify({subject:prefix+suffix}) });
    assert.equal(res.status, 200); const t = await res.json() as Tokens; users.add(t.userId); privateValues.push(t.accessToken,t.refreshToken); return t;
  }
  async function connect(web: Tokens, previous?: Pair) {
    const r = await call('/auth/vehicle-links', previous ? {installationId:previous.installationId,installationSecret:previous.installationSecret} : {});
    assert.equal(r.status,201); const p=await r.json() as Pair; installations.add(p.installationId);privateValues.push(p.deviceCode,p.userCode);
    if(p.installationSecret)privateValues.push(p.installationSecret);
    assert.equal((await call('/auth/vehicle-links/approve',{userCode:p.userCode},web.accessToken)).status,200);
    const exchange=await call('/auth/vehicle-links/exchange',{deviceCode:p.deviceCode}); assert.equal(exchange.status,200);
    const t=await exchange.json() as Tokens;privateValues.push(t.accessToken,t.refreshToken);return {pair:p,tokens:t};
  }
  async function stopChild() {
    if (child && child.exitCode === null) {
      const c=child; const exited=new Promise(resolve=>c.once('exit',resolve)); c.kill('SIGTERM');
      await Promise.race([exited,pause(12000).then(()=>{if(c.exitCode===null){c.kill('SIGKILL');throw new Error('Shutdown timed out');}})]);
    }
    child=undefined;
  }
  async function startChild() {
    const socket=createServer();await new Promise<void>(resolve=>socket.listen(0,'127.0.0.1',resolve));
    const port=(socket.address() as AddressInfo).port;await new Promise<void>(resolve=>socket.close(()=>resolve()));
    child=spawn(process.execPath,['dist/main.js'],{env:{...env,PORT:String(port)},stdio:['ignore','ignore','ignore']});
    const host='http://127.0.0.1:'+port;
    for(let i=0;i<100;i++){try{if((await fetch(host+'/api/v1/health/ready')).status===200)return host;}catch{ /* startup */ }await pause(50);}
    throw new Error('Compiled server startup failed');
  }
  try {
    const alice=await login('_alice'),bob=await login('_bob');
    const first=await connect(alice),other=await connect(bob);
    const token=first.tokens.accessToken;
    const dto={contractVersion:'1.0',appVersion:'test-1',installationId:first.pair.installationId,capabilities:caps(-1000),reportedSource:'SYNTHETIC'};
    await code(await call('/vehicle-sessions',dto),401,'UNAUTHENTICATED');
    await code(await call('/vehicle-sessions',dto,alice.accessToken,'create'),403,'VEHICLE_SESSION_REQUIRED');
    await code(await call('/vehicle-sessions',dto,token),400,'INVALID_IDEMPOTENCY_KEY');
    await code(await call('/vehicle-sessions',{...dto,installationId:other.pair.installationId},token,'create'),403,'INSTALLATION_NOT_LINKED');
    assert.equal((await call('/vehicle-sessions',[],token,'array')).status,400);
    assert.equal((await call('/vehicle-sessions',{...dto,capabilities:[caps()]},token,'arraycaps')).status,400);
    assert.equal((await call('/vehicle-sessions',{...dto,reportedSource:null},token,'source')).status,400);
    const creates=await Promise.all([call('/vehicle-sessions',dto,token,'create'),call('/vehicle-sessions',JSON.parse(JSON.stringify(dto)),token,'create')]);
    assert.ok(creates.every(r=>r.status===201)); assert.equal(creates.filter(r=>r.headers.get('Idempotency-Replayed')==='true').length,1);
    const created=await creates[0]!.json() as {id:string;status:string;reportedSource:string};
    assert.deepEqual(created,await creates[1]!.json()); assert.equal(created.reportedSource,'SYNTHETIC');
    assert.equal(await db.vehicleSession.count({where:{authSessionId:first.tokens.sessionId,creationKey:'create'}}),1);
    await code(await call('/vehicle-sessions',{...dto,appVersion:'changed'},token,'create'),409,'IDEMPOTENCY_CONFLICT');
    await code(await call('/vehicle-sessions',{...dto,contractVersion:'2.0'},token,'future'),422,'CONTRACT_VERSION_UNSUPPORTED');
    const path='/vehicle-sessions/'+created.id+'/events';
    const event=(id:string,sequence:number,offset:number,status='SUPPORTED')=>({contractVersion:'1.0',eventId:id,sequence,occurredAt:new Date(now+offset).toISOString(),type:'CAPABILITIES_REPORTED',payload:caps(offset,status)});
    const e2=event('two',2,0,'PERMISSION_DENIED');
    const writes=await Promise.all([call(path,e2,token,'two'),call(path,e2,token,'two')]);
    assert.ok(writes.every(r=>r.status===201));assert.equal(writes.filter(r=>r.headers.get('Idempotency-Replayed')==='true').length,1);
    const receipt=await writes[0]!.json() as Receipt;assert.deepEqual(receipt,await writes[1]!.json());
    assert.equal(await db.vehicleEvent.count({where:{sessionId:created.id,eventId:'two'}}),1);
    const delayed=await call(path,event('one',1,-2000,'UNKNOWN'),token,'one');assert.equal(delayed.status,201);assert.equal((await delayed.json() as Receipt).disposition,'STORED_OUT_OF_ORDER');
    const stale=await call(path,event('three',3,-1000),token,'three');assert.equal((await stale.json() as Receipt).disposition,'STORED_OUT_OF_ORDER');
    const oldChecks={...event('four',4,1000),payload:caps(-20000)};assert.equal((await call(path,oldChecks,token,'four')).status,201);
    const state=await (await call('/vehicle-sessions/'+created.id,{},token,undefined,base,'GET')).json() as {capabilities:ReturnType<typeof caps>;lastAppliedSequence:number};
    assert.equal(state.lastAppliedSequence,4);assert.equal(state.capabilities.steeringAngle!.status,'PERMISSION_DENIED');
    const e5=event('five',5,2000,'ERROR');const fifth=await call(path,e5,token,'five');assert.equal(fifth.status,201);const fifthBody=await fifth.json();
    const reordered={payload:e5.payload,type:e5.type,occurredAt:e5.occurredAt,sequence:e5.sequence,eventId:e5.eventId,contractVersion:e5.contractVersion};
    assert.deepEqual(await (await call(path,reordered,token,'five')).json(),fifthBody);
    await code(await call(path,{...e5,sequence:6},token,'five'),409,'IDEMPOTENCY_CONFLICT');
    await code(await call(path,event('reuse',5,2000),token,'reuse'),409,'SEQUENCE_CONFLICT');
    await code(await call(path,event('wrong',6,3000),token,'other'),400,'EVENT_KEY_MISMATCH');
    await code(await call(path,{...event('future',6,0),contractVersion:'2.0'},token,'future'),422,'CONTRACT_VERSION_UNSUPPORTED');
    await code(await call(path,event('old',6,-73*3600_000),token,'old'),422,'EVENT_TOO_OLD');
    await code(await call(path,event('clock',6,360_000),token,'clock'),422,'CLOCK_SKEW');
    assert.equal((await call(path,{...event('raw',6,3000),payload:{...caps(),speedKmh:10}},token,'raw')).status,400);
    assert.equal((await call(path,{...event('array',6,3000),payload:[caps()]},token,'array')).status,400);
    assert.equal((await call(path,{...event('badtime',6,0),occurredAt:'20261113T120000Z'},token,'badtime')).status,400);
    assert.equal((await call(path,{...event('mission',6,0),type:'RUN_FINISHED'},token,'mission')).status,400);
    assert.equal((await call(path,event('fraction',1.5,0),token,'fraction')).status,400);
    await code(await call(path,e2,other.tokens.accessToken,'two'),404,'RESOURCE_NOT_FOUND');

    // The event is written by one compiled API process and replayed by a new one.
    const e6=event('restart',6,3000,'UNSUPPORTED');
    const child1=await startChild();const fresh=await call(path,e6,token,'restart',child1);assert.equal(fresh.status,201);const firstBody=await fresh.json();
    await stopChild();const child2=await startChild();const replay=await call(path,e6,token,'restart',child2);assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replay.json(),firstBody);
    const scenario=spawn(process.execPath,['scripts/send-vehicle-scenario.mjs'],{env:{...env,PARKSICAL_API_BASE_URL:child2+'/api/v1',PARKSICAL_VEHICLE_ACCESS_TOKEN:token,PARKSICAL_INSTALLATION_ID:first.pair.installationId},stdio:['ignore','pipe','pipe']});
    let output='';scenario.stdout?.on('data',x=>{output+=x});scenario.stderr?.on('data',x=>{output+=x});
    assert.equal(await new Promise(resolve=>scenario.once('exit',resolve)),0);assert.match(output,/PASS: SYNTHETIC/);assert.ok(!output.includes(token));await stopChild();

    // Durable success replay precedes the 72-hour freshness check. Keep the synthetic auth row valid.
    await db.authSession.update({where:{id:first.tokens.sessionId},data:{accessExpiresAt:new Date(now+4*24*3600_000)}});
    context.mock.timers.enable({apis:['Date'],now:now+73*3600_000});
    try {
      const oldReplay=await call(path,e5,token,'five');assert.equal(oldReplay.status,201);assert.deepEqual(await oldReplay.json(),fifthBody);
      await code(await call(path,event('older-new-id',7,2000),token,'older-new-id'),422,'EVENT_TOO_OLD');
    }finally{context.mock.timers.reset();}
    const close={contractVersion:'1.0',eventId:'closed',sequence:7,occurredAt:new Date(now+4000).toISOString(),type:'SESSION_CLOSED',payload:{reason:'USER_ENDED'}};
    assert.equal((await call(path,close,token,'closed')).status,201);
    await code(await call(path,event('after',8,5000),token,'after'),409,'SESSION_CLOSED');
    assert.deepEqual(await (await call(path,e6,token,'restart')).json(),firstBody);
    assert.deepEqual(await (await call('/vehicle-sessions',dto,token,'create')).json(),created);
    assert.equal((await (await call('/vehicle-sessions/'+created.id,{},token,undefined,base,'GET')).json() as {status:string}).status,'CLOSED');

    // Unused lower close sequence still closes conservatively and never lowers lastAppliedSequence.
    const another=await (await call('/vehicle-sessions',dto,token,'closing')).json() as {id:string};
    const otherPath='/vehicle-sessions/'+another.id+'/events';
    assert.equal((await call(otherPath,event('ten',10,2000),token,'ten')).status,201);
    const lowClose=await call(otherPath,{...close,eventId:'close-low',sequence:3,occurredAt:new Date(now).toISOString()},token,'close-low');assert.equal(lowClose.status,201);assert.equal((await lowClose.json() as Receipt).lastAppliedSequence,10);

    const replacement=await connect(bob,first.pair);
    assert.equal((await call(path,e2,token,'two')).status,401);
    await code(await call(path,e2,replacement.tokens.accessToken,'two'),404,'RESOURCE_NOT_FOUND');
    assert.equal((await call('/auth/vehicle-links/'+first.pair.installationId,{},bob.accessToken,undefined,base,'DELETE')).status,204);
    assert.equal((await call('/vehicle-sessions',dto,replacement.tokens.accessToken,'blocked')).status,401);
    for(const value of privateValues)assert.ok(!JSON.stringify(records).includes(value));
  } finally {
    context.mock.timers.reset(); await stopChild();
    try {
      await db.vehicleEvent.deleteMany({where:{session:{userId:{in:[...users]}}}});
      await db.vehicleSession.deleteMany({where:{userId:{in:[...users]}}});
      await db.vehiclePairing.deleteMany({where:{installationId:{in:[...installations]}}});
      await db.authSession.deleteMany({where:{userId:{in:[...users]}}});
      await db.installation.deleteMany({where:{id:{in:[...installations]}}});
      await db.authIdentity.deleteMany({where:{userId:{in:[...users]}}});
      await db.user.deleteMany({where:{id:{in:[...users]}}});
      await db.authRateBucket.deleteMany();
    } finally { await app.close(); }
  }
});
