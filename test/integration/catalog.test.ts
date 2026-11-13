import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { asJson,writeRevision } from '../../src/lots/store.js';
import { CatalogService,candidateQuery } from '../../src/lots/catalog.service.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { LotSearchQuery } from '../../src/lots/search.dto.js';

test('real PG catalog: geo/filter/sort/pagination, authenticated detail/version/evidence, bounded projection and index',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const key='synthetic-catalog-development-key-000001',logs:Record<string,string|number>[]=[];
  const app=await createApp(readConfig({...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key}),r=>logs.push(r));
  await app.listen(0,'127.0.0.1');const base=await app.getUrl(),db=app.get(DatabaseService).client,prefix=randomUUID(),ids:string[]=[],users:string[]=[],installations:string[]=[];
  const fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto;
  const request=(path:string,token?:string,method='GET',body?:unknown,idem?:string)=>fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(token?{Authorization:'Bearer '+token}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  type Page=Awaited<ReturnType<CatalogService['search']>>;type Detail=Awaited<ReturnType<CatalogService['detail']>>;
  async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
  async function list(query:string,token:string){const r=await request('/lots?latitude=0&longitude=45&asOfYear=2026&'+query,token);assert.equal(r.status,200,await r.clone().text());return await r.json() as Page;}
  async function lot(suffix:string,patch:Partial<LotCreateDto['snapshot']>={}){
    const id=randomUUID();ids.push(id);const s={...structuredClone(fixture.snapshot),...patch};
    await db.$transaction(async tx=>{await tx.parkingLot.create({data:{id,code:prefix+suffix,currentVersion:1}});await writeRevision(tx,id,1,s);});return id;
  }
  try{
    const login=await request('/auth/development/login',undefined,'POST',{subject:prefix});const token=await login.json() as {userId:string;accessToken:string;sessionId:string};users.push(token.userId);
    const near=await lot('-near',{latitude:0,longitude:45.001,ownership:'PUBLIC',discounts:[{code:'EV',label:'가상 전기차 할인',conditions:'합성 조건, 실제 할인 아님'}],factorScores:{structure:4,review:null,driving:null,age:null}});
    const easy=await lot('-easy',{latitude:0,longitude:45.002,ownership:'PRIVATE',partnered:true,factorScores:{structure:1.5,review:null,driving:null,age:null}});
    const unknown=await lot('-unknown',{latitude:0,longitude:45.003,builtYear:null,structureStatus:'UNKNOWN',factorScores:{structure:null,review:null,driving:null,age:null}});
    const disabled=await lot('-disabled',{active:false});await lot('-far',{latitude:2});
    await error(await request('/lots?latitude=0&longitude=45'),401);await error(await request('/lots/'+near),401);
    await db.$queryRaw(candidateQuery({latitude:0,longitude:45} as LotSearchQuery));
    const p=await list('',token.accessToken);assert.deepEqual(p.items.map(x=>x.id),[near,easy,unknown]);assert.ok(Math.abs(p.items[0]!.distanceM-111.195)<.1);assert.equal(p.items[2]!.difficulty.score,null);
    assert.ok(!JSON.stringify(p).includes('parkingSpaces'));assert.ok(!JSON.stringify(p).includes('rightsNote'));assert.equal(p.items[0]!.navigation.usable,false);assert.equal(p.items[0]!.challenge.status,'NOT_CONFIGURED');
    assert.deepEqual((await list('sort=EASIEST',token.accessToken)).items.map(x=>x.id),[easy,near,unknown]);
    const adjusted=await list('sort=EASIEST&vehicleLengthMm=5100&vehicleWidthMm=1900',token.accessToken);assert.equal(adjusted.items[0]!.difficulty.vehicle.basis,'PROVIDED_DIMENSIONS');assert.ok(adjusted.items[0]!.difficulty.unroundedScore!>p.items[1]!.difficulty.unroundedScore!);
    assert.equal((await list('vehicleStatus=UNSUPPORTED',token.accessToken)).items[0]!.difficulty.vehicle.inputStatus,'UNSUPPORTED');
    assert.deepEqual((await list('ownership=PUBLIC&discountCode=EV',token.accessToken)).items.map(x=>x.id),[near]);assert.deepEqual((await list('partnered=true',token.accessToken)).items.map(x=>x.id),[easy]);
    assert.equal((await list('discountCode=NO_SUCH_DISCOUNT',token.accessToken)).items.length,0);
    assert.deepEqual((await list('south=-0.001&north=0.001&west=45& east=45.0015'.replace(' ',''),token.accessToken)).items.map(x=>x.id),[near]);
    assert.equal((await list('radiusM=200',token.accessToken)).items.length,1);
    const first=await list('limit=1',token.accessToken),second=await list('limit=1&cursor='+first.nextCursor!,token.accessToken);assert.equal(second.items[0]!.id,easy);
    await error(await request('/lots?latitude=0&longitude=45&asOfYear=2026&limit=2&cursor='+first.nextCursor!,token.accessToken),400,'INVALID_SEARCH_CURSOR');
    const detailResponse=await request('/lots/'+near+'?asOfYear=2026',token.accessToken);assert.equal(detailResponse.status,200);const detail=await detailResponse.json() as Detail;
    assert.equal(detail.snapshot.parkingSpaces!.length,32);assert.equal(detail.snapshot.pillars!.length,12);assert.equal(detail.discounts![0]!.code,'EV');assert.equal(detail.snapshot.source,'SYNTHETIC');
    const score=await (await request('/lots/'+near+'/difficulty?asOfYear=2026',token.accessToken)).json();assert.deepEqual(detail.difficulty,score);
    const partial=await (await request('/lots/'+unknown,token.accessToken)).json() as Detail;assert.equal(partial.discounts,null);assert.equal(partial.snapshot.structureStatus,'UNKNOWN');
    for(const q of ['latitude=91&longitude=0','latitude=0','latitude=0&longitude=45&radiusM=20001','latitude=0&longitude=45&limit=51','latitude=0&longitude=45&south=0','latitude=0&longitude=45&south=0&north=1&west=0&east=1','latitude=0&longitude=45&cursor=bad','latitude=0&longitude=45&vehicleLengthMm=4800','latitude=0&longitude=45&lotVersion=1','latitude=0&longitude=45&q=Seoul','latitude=0&longitude=45&partnered=1','latitude=0&latitude=1&longitude=0'])await error(await request('/lots?'+q,token.accessToken),400);
    await error(await request('/lots?latitude=0&longitude=45&ruleVersion=future',token.accessToken),422,'DIFFICULTY_RULE_UNSUPPORTED');
    for(const id of [disabled,randomUUID()])await error(await request('/lots/'+id,token.accessToken),404);
    const pair=await (await request('/auth/vehicle-links',undefined,'POST',{})).json() as {installationId:string;deviceCode:string;userCode:string};installations.push(pair.installationId);
    assert.equal((await request('/auth/vehicle-links/approve',token.accessToken,'POST',{userCode:pair.userCode})).status,200);
    const vehicle=await (await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:pair.deviceCode})).json() as {accessToken:string};assert.equal((await request('/lots/'+near,vehicle.accessToken)).status,200);assert.equal((await list('',vehicle.accessToken)).items.length,3);
    await db.user.update({where:{id:token.userId},data:{role:'ADMIN'}});
    for(const discounts of [[null],[{code:'EV',label:'x',conditions:'x'},{code:'EV',label:'y',conditions:'y'}]])await error(await request('/admin/lots/'+near,token.accessToken,'PUT',{expectedVersion:1,snapshot:{...fixture.snapshot,discounts}},'invalid-discount'),400);
    const edit={...fixture.snapshot,latitude:0,longitude:45.001,name:'가상 수정',discounts:[]};
    assert.equal((await request('/admin/lots/'+near,token.accessToken,'PUT',{expectedVersion:1,snapshot:edit},'edit')).status,200);
    await error(await request('/lots?latitude=0&longitude=45&asOfYear=2026&limit=1&cursor='+first.nextCursor!,token.accessToken),409,'SEARCH_CHANGED');
    const old=await (await request('/lots/'+near+'?lotVersion=1',token.accessToken)).json() as Detail;assert.equal(old.version,1);assert.equal(old.currentVersion,2);assert.equal(old.snapshot.name,fixture.snapshot.name);
    assert.equal((await list('discountCode=EV',token.accessToken)).items.length,0);
    assert.equal((await request('/admin/lots/'+near,token.accessToken,'PUT',{expectedVersion:2,snapshot:{...edit,active:false}},'disable')).status,200);
    await error(await request('/lots/'+near+'?lotVersion=1',token.accessToken),404);
    await db.lotRevision.update({where:{lotId_version:{lotId:easy,version:1}},data:{source:'REAL'}});
    await error(await request('/lots/'+easy,token.accessToken),422,'LOT_SOURCE_UNSUPPORTED');
    assert.equal((await list('',token.accessToken)).items.some(x=>x.id===easy),false);
    await db.lotRevision.update({where:{lotId_version:{lotId:easy,version:1}},data:{source:'SYNTHETIC'}});
    for(const [latitude,longitude,lotLatitude,lotLongitude] of [[0,179.999,0,-179.999],[90,0,89.999,100]]) {
      const geoId=await lot('-geo-'+latitude,{latitude:lotLatitude!,longitude:lotLongitude!});
      const geoResponse=await request('/lots?latitude='+latitude+'&longitude='+longitude+'&radiusM=3000',token.accessToken);
      assert.equal(geoResponse.status,200);const geoPage=await geoResponse.json() as Page;
      assert.ok(geoPage.items.some(x=>x.id===geoId));assert.ok(geoPage.items.find(x=>x.id===geoId)!.distanceM<300);
    }
    // Actual SQL query and planner with many rows; fixtures exist only in this test DB.
    const bulk=Array.from({length:3000},()=>({id:randomUUID(),code:randomUUID(),currentVersion:1}));ids.push(...bulk.map(x=>x.id));
    await db.parkingLot.createMany({data:bulk});
    const tiny={...fixture.snapshot,structureStatus:'UNKNOWN',floors:[],zones:[],entrances:[],ramps:[],parkingSpaces:[],pillars:[],driveAisles:[]};
    await db.lotRevision.createMany({data:bulk.map((x,i)=>({lotId:x.id,version:1,name:'bulk',active:true,latitude:i<1001?0:45+(i%100)/100,longitude:i<1001?45.004:80,ownership:'PRIVATE',parkingType:'SELF_PARK',partnered:false,builtYear:2020,source:'SYNTHETIC',sourceUpdatedAt:new Date(fixture.snapshot.sourceUpdatedAt),structureStatus:'UNKNOWN',snapshot:asJson(tiny)}))});
    await error(await request('/lots?latitude=0&longitude=45',token.accessToken),422,'SEARCH_TOO_BROAD');
    await db.$executeRaw`ANALYZE "LotRevision"`;await db.$executeRaw`ANALYZE "ParkingLot"`;
    const sql=candidateQuery({latitude:45,longitude:80,radiusM:100} as LotSearchQuery);
    const plan=await db.$queryRawUnsafe<unknown[]>('EXPLAIN (FORMAT JSON) '+sql.text,...sql.values);
    assert.ok(JSON.stringify(plan).includes('LotRevision_source_active_latitude_longitude_idx'),JSON.stringify(plan));
    console.log('CATALOG QUERY PLAN',JSON.stringify(plan));
    await db.authRateBucket.update({where:{key:createHash('sha256').update('catalog-read:'+token.sessionId).digest('hex')},data:{count:300}});
    const limited=await request('/lots?latitude=0&longitude=45',token.accessToken);await error(limited,429,'RATE_LIMITED');assert.equal(limited.headers.get('retry-after'),'300');
    await request('/auth/logout',token.accessToken,'POST');await error(await request('/lots/'+easy,token.accessToken),401);
    for(const value of [token.accessToken,vehicle.accessToken,'latitude','vehicleLengthMm',fixture.snapshot.address])assert.ok(!JSON.stringify(logs).includes(value));
    if(process.env.CATALOG_CAPTURE_DIR){await writeFile(process.env.CATALOG_CAPTURE_DIR+'/catalog-page.json',JSON.stringify(p,null,2));await writeFile(process.env.CATALOG_CAPTURE_DIR+'/catalog-detail.json',JSON.stringify(detail,null,2));}
  }finally{
    try{
      await db.lotMutation.deleteMany({where:{authSession:{userId:{in:users}}}});
      await db.parkingSpace.deleteMany({where:{lotId:{in:ids}}});await db.lotDriveAisle.deleteMany({where:{lotId:{in:ids}}});await db.lotPillar.deleteMany({where:{lotId:{in:ids}}});await db.lotRamp.deleteMany({where:{lotId:{in:ids}}});await db.lotEntrance.deleteMany({where:{lotId:{in:ids}}});await db.lotZone.deleteMany({where:{lotId:{in:ids}}});await db.lotFloor.deleteMany({where:{lotId:{in:ids}}});
      await db.lotRevision.deleteMany({where:{lotId:{in:ids}}});await db.parkingLot.deleteMany({where:{id:{in:ids}}});await db.vehiclePairing.deleteMany({where:{installationId:{in:installations}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.installation.deleteMany({where:{id:{in:installations}}});await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();
    }finally{await app.close();}
  }
});
