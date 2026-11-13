import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { seedSyntheticLot, SYNTHETIC_LOT_ID } from '../../src/lots/seed-store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { calculateDifficulty } from '../../src/difficulty/calculator.js';

test('real PG difficulty API: vehicle/reference basis, source/missing evidence, history, deactivation and strict inputs',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const key='synthetic-difficulty-development-key-000001',logs:Record<string,string|number>[]=[];
  const app=await createApp(readConfig({...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key}),r=>logs.push(r));
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),db=app.get(DatabaseService).client;
  const users:string[]=[],installations:string[]=[],prefix=randomUUID();
  type Tokens={userId:string;sessionId:string;accessToken:string};
  type Result=ReturnType<typeof calculateDifficulty>&{lotId:string;lotVersion:number;currentLotVersion:number;sourceUpdatedAt:string};
  const request=(path:string,token?:string,method='GET',body?:unknown,idempotency?:string)=>fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),'X-Development-Key':key,...(idempotency?{'Idempotency-Key':idempotency}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  async function login(suffix:string){const r=await request('/auth/development/login',undefined,'POST',{subject:prefix+suffix});assert.equal(r.status,200);const t=await r.json() as Tokens;users.push(t.userId);return t;}
  async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('Cache-Control'),'no-store');if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
  const path='/lots/'+SYNTHETIC_LOT_ID+'/difficulty';
  try{
    const alice=await login('-a'),bob=await login('-b');
    await seedSyntheticLot(db,{NODE_ENV:'test',ALLOW_SYNTHETIC_SEED:'true'});
    await error(await request(path),401);
    const r=await request(path+'?asOfYear=2026',alice.accessToken);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');
    const reference=await r.json() as Result;
    assert.equal(reference.lotVersion,1);assert.equal(reference.score,2.5);assert.equal(reference.baseScore,2.254545);
    assert.equal(reference.dataSource,'SYNTHETIC');assert.equal(reference.coverage.availableWeight,.55);assert.equal(reference.vehicle.basis,'REFERENCE_DEFAULT');
    assert.equal(reference.factors[1]!.sampleCount,null);assert.equal(reference.factors[1]!.contribution,null);
    assert.deepEqual(await (await request(path+'?asOfYear=2026',bob.accessToken)).json(),reference,'catalog score is not a private user resource');
    assert.deepEqual(await (await request(path+'?asOfYear=2026&ruleVersion=difficulty-v1',alice.accessToken)).json(),reference);
    const dimensions='&vehicleLengthMm=5100&vehicleWidthMm=1900';
    const adjusted=await (await request(path+'?asOfYear=2026'+dimensions,alice.accessToken)).json() as Result;
    assert.equal(adjusted.vehicle.basis,'PROVIDED_DIMENSIONS');assert.equal(adjusted.vehicle.appliedAdjustment,.32);assert.equal(adjusted.unroundedScore,2.574545);
    const small=await (await request(path+'?asOfYear=2026&vehicleLengthMm=3600&vehicleWidthMm=1900',alice.accessToken)).json() as Result;
    assert.ok(adjusted.score!>=small.score!);
    const unsupported=await (await request(path+'?asOfYear=2026&vehicleStatus=UNSUPPORTED',alice.accessToken)).json() as Result;
    assert.equal(unsupported.vehicle.inputStatus,'UNSUPPORTED');assert.equal(unsupported.vehicle.basis,'REFERENCE_DEFAULT');assert.equal(unsupported.score,reference.score);
    for(const q of ['vehicleLengthMm=4800','vehicleWidthMm=1850','vehicleStatus=SUPPORTED','vehicleStatus=UNSUPPORTED&vehicleLengthMm=4800&vehicleWidthMm=1850','vehicleLengthMm=999&vehicleWidthMm=1850','vehicleLengthMm=1e3&vehicleWidthMm=1850','vehicleLengthMm=0x12c0&vehicleWidthMm=1850','vehicleLengthMm=4800&vehicleLengthMm=5100&vehicleWidthMm=1850','asOfYear=1999','lotVersion=0','structureScore=5','vehicleStatus=AVAILABLE'])await error(await request(path+'?'+q,alice.accessToken),400);
    await error(await request(path+'?ruleVersion=future',alice.accessToken),422,'DIFFICULTY_RULE_UNSUPPORTED');
    await error(await request(path+'?lotVersion=99',alice.accessToken),404);
    await error(await request('/lots/'+randomUUID()+'/difficulty',alice.accessToken),404);
    const pair=await (await request('/auth/vehicle-links',undefined,'POST',{})).json() as {installationId:string;deviceCode:string;userCode:string};installations.push(pair.installationId);
    assert.equal((await request('/auth/vehicle-links/approve',alice.accessToken,'POST',{userCode:pair.userCode})).status,200);
    const vehicle=await (await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:pair.deviceCode})).json() as Tokens;
    assert.deepEqual(await (await request(path+'?asOfYear=2026',vehicle.accessToken)).json(),reference,'SDK vehicle bearer may read the calculation');
    await db.user.update({where:{id:alice.userId},data:{role:'ADMIN'}});
    const fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto;
    const missing={...fixture.snapshot,factorScores:{structure:null,review:5,driving:5,age:5}};
    assert.equal((await request('/admin/lots/'+SYNTHETIC_LOT_ID,alice.accessToken,'PUT',{expectedVersion:1,snapshot:missing},'missing')).status,200);
    const incomplete=await (await request(path+'?asOfYear=2026',alice.accessToken)).json() as Result;
    assert.equal(incomplete.status,'INSUFFICIENT_DATA');assert.equal(incomplete.score,null);assert.equal(incomplete.coverage.availableWeight,.15);
    assert.equal(incomplete.factors[1]!.status,'SAMPLE_COUNT_UNKNOWN');assert.equal(incomplete.factors[2]!.status,'SAMPLE_COUNT_UNKNOWN');
    assert.equal(incomplete.factors[3]!.score,1.6,'authored age=5 is not substituted for year derivation');
    const historical=await (await request(path+'?asOfYear=2026&lotVersion=1',alice.accessToken)).json() as Result;
    assert.equal(historical.score,reference.score);assert.equal(historical.lotVersion,1);assert.equal(historical.currentLotVersion,2);
    await db.lotRevision.update({where:{lotId_version:{lotId:SYNTHETIC_LOT_ID,version:2}},data:{source:'REAL'}});
    await error(await request(path,alice.accessToken),422,'LOT_SOURCE_UNSUPPORTED');
    await db.lotRevision.update({where:{lotId_version:{lotId:SYNTHETIC_LOT_ID,version:2}},data:{source:'SYNTHETIC'}});
    assert.equal((await request('/admin/lots/'+SYNTHETIC_LOT_ID,alice.accessToken,'PUT',{expectedVersion:2,snapshot:{...missing,active:false}},'disable')).status,200);
    await error(await request(path,alice.accessToken),404);await error(await request(path+'?lotVersion=1',alice.accessToken),404,'RESOURCE_NOT_FOUND');
    const rateKey=createHash('sha256').update('difficulty-read:'+bob.sessionId).digest('hex');
    await db.authRateBucket.update({where:{key:rateKey},data:{count:300}});
    const limited=await request(path,bob.accessToken);await error(limited,429,'RATE_LIMITED');assert.equal(limited.headers.get('Retry-After'),'300');
    await request('/auth/logout',bob.accessToken,'POST');await error(await request(path,bob.accessToken),401);
    const text=JSON.stringify(logs);for(const value of [alice.accessToken,bob.accessToken,vehicle.accessToken,'vehicleLengthMm',fixture.snapshot.address])assert.ok(!text.includes(value));
  }finally{
    try{
      await db.lotMutation.deleteMany({where:{authSession:{userId:{in:users}}}});
      await db.parkingSpace.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});await db.lotDriveAisle.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});
      await db.lotPillar.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});await db.lotRamp.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});await db.lotEntrance.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});
      await db.lotZone.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});await db.lotFloor.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});await db.lotRevision.deleteMany({where:{lotId:SYNTHETIC_LOT_ID}});await db.parkingLot.deleteMany({where:{id:SYNTHETIC_LOT_ID}});
      await db.vehiclePairing.deleteMany({where:{installationId:{in:installations}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.installation.deleteMany({where:{id:{in:installations}}});
      await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();
    }finally{await app.close();}
  }
});
