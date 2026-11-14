import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { execFileSync,spawn } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { writeRevision } from '../../src/lots/store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { RunResultDto } from '../../src/missions/dto.js';
import type { StagePlan } from '../../src/missions/rules.js';

test('real PG mission runs: strict HTTP contract, immutable versions, concurrency/rollback, synthetic outcomes and process restart',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const key='synthetic-missions-development-key-000001',prefix=randomUUID(),logs:Record<string,string|number>[]=[];
  const env={...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key,DEV_MISSIONS_ENABLED:'true'};
  let app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');let base=await app.getUrl();
  const db=app.get(DatabaseService).client,fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto;
  const scenarios=JSON.parse(await readFile('fixtures/missions/result-scenarios.json','utf8')) as {scenarios:{name:string;result:RunResultDto}[]};
  const lotId=randomUUID(),users:string[]=[],installs:string[]=[];
  type Token={userId:string;accessToken:string;sessionId:string};
  type Catalog={lotId:string;structureVersion:number;ruleVersion:string;operationalAllowed:boolean;items:{missionCode:string;stage:StagePlan|null}[]};
  const request=(path:string,token?:string,method='GET',body?:unknown,idem?:string)=>fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(token?{Authorization:'Bearer '+token}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
  async function login(n:number){const r=await request('/auth/development/login',undefined,'POST',{subject:prefix+'-'+n});assert.equal(r.status,200);const t=await r.json() as Token;if(!users.includes(t.userId))users.push(t.userId);return t;}
  async function pair(owner:Token){const start=await (await request('/auth/vehicle-links',undefined,'POST',{})).json() as {installationId:string;deviceCode:string;userCode:string;installationSecret:string};installs.push(start.installationId);assert.equal((await request('/auth/vehicle-links/approve',owner.accessToken,'POST',{userCode:start.userCode})).status,200);return {...await (await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:start.deviceCode})).json() as Token,installationId:start.installationId,installationSecret:start.installationSecret};}
  try{
    await db.$transaction(async tx=>{await tx.parkingLot.create({data:{id:lotId,code:prefix,currentVersion:1}});await writeRevision(tx,lotId,1,fixture.snapshot);});
    const alice=await login(0),bob=await login(1),vehicle=await pair(alice),other=await pair(bob),secondInstall=await pair(alice);
    const startedAt=new Date(Date.now()-60000).toISOString();
    const capabilities=Object.fromEntries(['gear','speed','steeringAngle','brake','safetyWarnings','carProfile','navigation'].map(signal=>[signal,{status:'SUPPORTED',checkedAt:startedAt}]));
    async function session(v:typeof vehicle,patch:Record<string,unknown>={}){const r=await request('/vehicle-sessions',v.accessToken,'POST',{contractVersion:'1.0',appVersion:'synthetic-1',installationId:v.installationId,reportedSource:'SYNTHETIC',capabilities,...patch},'session-'+randomUUID());assert.equal(r.status,201,await r.clone().text());return (await r.json() as {id:string}).id;}
    const sessionId=await session(vehicle),otherSession=await session(other),unsupported=await session(vehicle,{capabilities:{...capabilities,steeringAngle:{status:'UNSUPPORTED',checkedAt:startedAt}}}),notSynthetic=await session(vehicle,{reportedSource:'APP_REPORTED'}),staleSession=await session(vehicle,{capabilities:{...capabilities,speed:{status:'SUPPORTED',checkedAt:new Date(new Date(startedAt).getTime()-600001).toISOString()}}});
    const catalogPath='/missions?lotId='+lotId+'&structureVersion=1';
    const catalogResponse=await request(catalogPath,alice.accessToken);assert.equal(catalogResponse.status,200);const catalog=await catalogResponse.json() as Catalog;
    assert.equal(catalog.operationalAllowed,false);assert.equal(catalog.items.length,5);
    const reverse=catalog.items.find(i=>i.missionCode==='ONE_SHOT_REVERSE')!.stage!,smooth=catalog.items.find(i=>i.missionCode==='SMOOTH_STEERING')!.stage!;
    const create=(id:string,stages=[reverse.stageId])=>({contractVersion:'1.0',clientRunId:id,vehicleSessionId:sessionId,lotId,structureVersion:1,ruleVersion:'missions-v1',source:'SYNTHETIC',mode:'CHALLENGE',startedAt,stageIds:stages});
    const success=()=>{const dto=structuredClone(scenarios.scenarios.find(s=>s.name==='reverse-success')!.result);dto.finishedAt=new Date(new Date(startedAt).getTime()+dto.elapsedMs).toISOString();return dto;};
    await error(await request(catalogPath),401);await error(await request(catalogPath+'&rawSignals=x',alice.accessToken),400);
    await error(await request('/runs',alice.accessToken,'POST',create('web'),'web'),403,'VEHICLE_SESSION_REQUIRED');
    await error(await request('/runs',vehicle.accessToken,'POST',create('missing-key')),400,'INVALID_IDEMPOTENCY_KEY');
    for(const patch of [{source:'APP_REPORTED'},{userId:alice.userId},{rawSignals:[]},{structureVersion:'1'},{stageIds:[]},{stageIds:[reverse.stageId,reverse.stageId]}])await error(await request('/runs',vehicle.accessToken,'POST',{...create('invalid'),...patch},'invalid'),400);
    for(const patch of [{vehicleSessionId:otherSession},{vehicleSessionId:notSynthetic}])await error(await request('/runs',vehicle.accessToken,'POST',{...create('bad-session'),...patch},'bad-session'),404);
    for(const patch of [{ruleVersion:'unknown-v2'},{structureVersion:99},{stageIds:['PILLAR_FOREST:fake']},{stageIds:['TIME_ATTACK:fake']},{vehicleSessionId:unsupported,stageIds:[smooth.stageId]},{vehicleSessionId:staleSession}])await error(await request('/runs',vehicle.accessToken,'POST',{...create('unsupported'),...patch},'unsupported'),422);
    const disabled=await createApp(readConfig({...env,DEV_MISSIONS_ENABLED:'false'}),()=>{});await disabled.listen(0,'127.0.0.1');try{await error(await fetch(await disabled.getUrl()+'/api/v1'+catalogPath,{headers:{Authorization:'Bearer '+alice.accessToken}}),403,'MISSIONS_POLICY_DISABLED');}finally{await disabled.close();}
    const creates=await Promise.all([request('/runs',vehicle.accessToken,'POST',create('first'),'create'),request('/runs',vehicle.accessToken,'POST',create('first'),'create')]);assert.deepEqual(creates.map(r=>r.status),[201,201]);
    const first=await creates[0]!.json() as {runId:string;version:number};assert.deepEqual(first,await creates[1]!.json());assert.equal(creates.filter(r=>r.headers.get('Idempotency-Replayed')==='true').length,1);
    const id=first.runId,resultPath='/runs/'+id+'/result';assert.equal(await db.missionRun.count({where:{userId:alice.userId,clientRunId:'first'}}),1);
    const recovery=await (await request('/runs/'+id,vehicle.accessToken)).json() as Record<string,unknown>;assert.equal(recovery.state,'ACTIVE');assert.equal(recovery.result,null);assert.equal(recovery.version,1);
    assert.equal((await request('/runs/'+id,alice.accessToken)).status,200);
    await error(await request('/runs/'+id,bob.accessToken),404);await error(await request('/runs/'+id,secondInstall.accessToken),404);
    await error(await request(resultPath,other.accessToken,'POST',success(),'other'),404);
    await error(await request('/runs',vehicle.accessToken,'POST',{...create('first'),mode:'PRACTICE'},'different-key'),409,'RUN_CONFLICT');
    await error(await request('/runs',vehicle.accessToken,'POST',create('second'),'create'),409,'IDEMPOTENCY_CONFLICT');
    for(const patch of [{stars:2},{elapsedMs:0},{stages:[]},{stages:[{...success().stages[0],stars:2}]},{stages:[{...success().stages[0],stageId:'ONE_SHOT_REVERSE:other'}]}])await error(await request(resultPath,vehicle.accessToken,'POST',{...success(),...patch},'bad-result'),422);
    for(const patch of [{source:'REAL'},{stages:[{...success().stages[0],metrics:{...success().stages[0]!.metrics,speed:[1,2]}}]},{stages:[{...success().stages[0],quality:[null]}]}])await error(await request(resultPath,vehicle.accessToken,'POST',{...success(),...patch},'bad-result'),400);
    const resultInput=success();
    // If receipt storage fails, the terminal insert must roll back too.
    await db.$executeRawUnsafe(`CREATE FUNCTION test_mission_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='rollback' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_mission_failure BEFORE INSERT ON "MissionRunMutation" FOR EACH ROW EXECUTE FUNCTION test_mission_failure()');
    try{await error(await request('/runs',vehicle.accessToken,'POST',create('rollback-create'),'rollback'),500);assert.equal(await db.missionRun.count({where:{userId:alice.userId,clientRunId:'rollback-create'}}),0);await error(await request(resultPath,vehicle.accessToken,'POST',resultInput,'rollback'),500);}finally{await db.$executeRawUnsafe('DROP TRIGGER test_mission_failure ON "MissionRunMutation"');await db.$executeRawUnsafe('DROP FUNCTION test_mission_failure()');}
    assert.equal(await db.missionRunResult.count({where:{runId:id}}),0);assert.equal(await db.missionRunMutation.count({where:{key:'rollback',userId:alice.userId}}),0);
    const results=await Promise.all([request(resultPath,vehicle.accessToken,'POST',resultInput,'finish'),request(resultPath,vehicle.accessToken,'POST',resultInput,'finish-duplicate')]);assert.deepEqual(results.map(r=>r.status),[201,201]);const receipt=await results[0]!.json() as Record<string,unknown>;assert.deepEqual(receipt,await results[1]!.json());assert.equal(results.filter(r=>r.headers.get('Idempotency-Replayed')==='true').length,1);assert.equal(await db.missionRunResult.count({where:{runId:id}}),1);
    assert.equal(receipt.state,'COMPLETED');assert.equal(receipt.stars,3);assert.equal(receipt.recognitionStatus,'SYNTHETIC_NOT_ELIGIBLE');assert.equal(receipt.physicalVerification,'UNVERIFIED');assert.equal(receipt.rankingEligible,false);assert.equal(receipt.rewardEligible,false);
    await error(await request(resultPath,vehicle.accessToken,'POST',{...resultInput,clientResultId:'conflict'},'finish'),409,'IDEMPOTENCY_CONFLICT');
    await error(await request(resultPath,vehicle.accessToken,'POST',{...resultInput,clientResultId:'conflict'},'new-final'),409,'RUN_ALREADY_FINAL');
    await assert.rejects(db.missionRun.update({where:{id},data:{ruleVersion:'forged-v2'}}));await assert.rejects(db.missionRunResult.update({where:{runId:id},data:{stars:1}}));
    const evidence:Record<string,unknown>={};
    for(const s of scenarios.scenarios){
      const report=structuredClone(s.result);report.finishedAt=new Date(new Date(startedAt).getTime()+report.elapsedMs).toISOString();
      const created=await request('/runs',vehicle.accessToken,'POST',create(s.name,[report.stages[0]!.stageId]),'scenario-'+s.name);assert.equal(created.status,201,await created.clone().text());const runId=(await created.json() as {runId:string}).runId;
      const r=await request('/runs/'+runId+'/result',vehicle.accessToken,'POST',report,'result-'+s.name);assert.equal(r.status,201,await r.clone().text());const body=await r.json() as Record<string,unknown>;assert.equal(body.state,report.outcome,s.name);assert.equal(body.stars,report.stars);evidence[s.name]=body;
    }
    const competing=(await (await request('/runs',vehicle.accessToken,'POST',create('terminal-race'),'race-create')).json() as {runId:string}).runId;
    const otherFinal={...success(),clientResultId:'another'};
    const race=await Promise.all([request('/runs/'+competing+'/result',vehicle.accessToken,'POST',success(),'race-a'),request('/runs/'+competing+'/result',vehicle.accessToken,'POST',otherFinal,'race-b')]);assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);
    const page=await (await request('/runs?limit=2',vehicle.accessToken)).json() as {items:{id:string}[];nextCursor:string};assert.equal(page.items.length,2);assert.ok(page.nextCursor);assert.equal((await request('/runs?limit=2&cursor='+page.nextCursor,vehicle.accessToken)).status,200);await error(await request('/runs?limit=3&cursor='+page.nextCursor,vehicle.accessToken),400);await error(await request('/runs?limit=2&cursor='+page.nextCursor,bob.accessToken),400);
    // Structure can change without rewriting the pinned run or historical stage references.
    await db.$transaction(async tx=>{await writeRevision(tx,lotId,2,{...fixture.snapshot,name:'Synthetic revision 2'});await tx.parkingLot.update({where:{id:lotId},data:{currentVersion:2}});});
    const frozen=await (await request('/runs/'+id,alice.accessToken)).json() as {structureVersion:number;ruleVersion:string;rules:{maxSpeedKph:number};result:{report:RunResultDto}};assert.equal(frozen.structureVersion,1);assert.equal(frozen.ruleVersion,'missions-v1');assert.equal(frozen.rules.maxSpeedKph,10);
    // Rebuild the Nest app and its pool, then replay the exact final receipt from persistent PG.
    await app.close();app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');base=await app.getUrl();
    const resumed=await request(resultPath,vehicle.accessToken,'POST',resultInput,'finish');assert.equal(resumed.status,201);assert.equal(resumed.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await resumed.json(),receipt);
    assert.deepEqual(await (await request('/runs/'+id,alice.accessToken)).json(),frozen);
    const child=spawn(process.execPath,['dist/main.js'],{env:{...env,PORT:'39072'},stdio:['ignore','ignore','ignore']});
    try{
      let ready=false;
      for(let i=0;i<50;i++){try{ready=(await fetch('http://127.0.0.1:39072/api/v1/health/ready')).status===200;if(ready)break;}catch{/* Child may still be starting. */}await pause(100);}
      assert.equal(ready,true,'compiled API child ready');
      const persisted=await fetch('http://127.0.0.1:39072/api/v1/runs/'+id,{headers:{Authorization:'Bearer '+alice.accessToken}});assert.equal(persisted.status,200);assert.deepEqual(await persisted.json(),frozen);
      const replay=await fetch('http://127.0.0.1:39072/api/v1'+resultPath,{method:'POST',headers:{Authorization:'Bearer '+vehicle.accessToken,'Content-Type':'application/json','Idempotency-Key':'finish'},body:JSON.stringify(resultInput)});assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replay.json(),receipt);
    }finally{if(child.exitCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await done;}}
    const db2=app.get(DatabaseService).client;
    const rateKey=createHash('sha256').update('missions-read:'+alice.userId).digest('hex');await db2.$executeRaw`INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES (${rateKey},NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300`;
    await error(await request('/runs/'+id,alice.accessToken),429,'RATE_LIMITED');await db2.authRateBucket.deleteMany({where:{key:rateKey}});
    assert.equal((await request('/auth/vehicle-links/'+vehicle.installationId,alice.accessToken,'DELETE')).status,204);await error(await request(resultPath,vehicle.accessToken,'POST',resultInput,'finish'),401);
    const relink=await (await request('/auth/vehicle-links',undefined,'POST',{installationId:vehicle.installationId,installationSecret:vehicle.installationSecret})).json() as {userCode:string;deviceCode:string};
    assert.equal((await request('/auth/vehicle-links/approve',alice.accessToken,'POST',{userCode:relink.userCode})).status,200);const newVehicle=await (await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:relink.deviceCode})).json() as Token;
    assert.equal((await request('/runs/'+id,newVehicle.accessToken)).status,200);await error(await request(resultPath,newVehicle.accessToken,'POST',resultInput,'finish'),404);
    for(const secret of [key,vehicle.accessToken,alice.accessToken,lotId,...users,'maxSpeedKph','rawSignals'])assert.ok(!JSON.stringify(logs).includes(secret));
    if(process.env.MISSIONS_CAPTURE_DIR){const responses={'mission-catalog.json':catalog,'run-create.json':create('example-run'),'run-created.json':first,'run-result.json':resultInput,'run-receipt.json':receipt,'run-detail.json':frozen,'run-page.json':page,'run-scenario-receipts.json':evidence};for(const [name,value]of Object.entries(responses))await writeFile(process.env.MISSIONS_CAPTURE_DIR+'/'+name,JSON.stringify(value,null,2)+'\n');}
  }finally{
    const clean=app.get(DatabaseService).client;
    try{
      await clean.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_mission_failure ON "MissionRunMutation"');await clean.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_mission_failure()');
      await clean.missionRunMutation.deleteMany({where:{userId:{in:users}}});await clean.missionRunResult.deleteMany({where:{run:{userId:{in:users}}}});await clean.missionRun.deleteMany({where:{userId:{in:users}}});
      await clean.vehicleEvent.deleteMany({where:{session:{userId:{in:users}}}});await clean.vehicleSession.deleteMany({where:{userId:{in:users}}});
      await clean.parkingSpace.deleteMany({where:{lotId}});
      await clean.lotDriveAisle.deleteMany({where:{lotId}});
      await clean.lotPillar.deleteMany({where:{lotId}});
      await clean.lotRamp.deleteMany({where:{lotId}});
      await clean.lotEntrance.deleteMany({where:{lotId}});
      await clean.lotZone.deleteMany({where:{lotId}});
      await clean.lotFloor.deleteMany({where:{lotId}});
      await clean.lotRevision.deleteMany({where:{lotId}});await clean.parkingLot.deleteMany({where:{id:lotId}});await clean.vehiclePairing.deleteMany({where:{installationId:{in:installs}}});await clean.authSession.deleteMany({where:{userId:{in:users}}});await clean.installation.deleteMany({where:{id:{in:installs}}});await clean.authIdentity.deleteMany({where:{userId:{in:users}}});await clean.user.deleteMany({where:{id:{in:users}}});await clean.authRateBucket.deleteMany();
    }finally{await app.close();}
  }
});
