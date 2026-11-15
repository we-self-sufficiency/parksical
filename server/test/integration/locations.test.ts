import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import sharp from 'sharp';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { writeRevision } from '../../src/lots/store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { LocationCreateDto } from '../../src/locations/dto.js';

test('real PG private locations/photos: offline dedup, corrections, history, references, image rollback, restart, ownership and revocation',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const key='synthetic-location-development-key-000001',prefix=randomUUID(),logs:Record<string,string|number>[]=[];
  const env={...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key,DEV_LOCATIONS_ENABLED:'true'};
  let app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');let base=await app.getUrl(),db=app.get(DatabaseService).client;
  const fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto,lotIds=[randomUUID(),randomUUID()],users:string[]=[],installations:string[]=[];
  type Tokens={userId:string;accessToken:string;sessionId:string};
  type Receipt={locationId:string;version:number;deleted:boolean;accessEpoch:number;photoId?:string;photoDeleted?:boolean};
  type Selection={structureVersion:number|null;floorId:string|null;zoneId:string|null;parkingSpaceId:string|null;parkingSpace:{label:string;center:unknown}|null};
  type Location={id:string;version:number;accessEpoch:number;selection:Selection;original:Selection;note:string|null;userEdited:boolean;confidence:string;photos:{id:string;width:number;height:number;byteSize:number}[];occurredAt:string;receivedAt:string};
  const request=(path:string,token?:string,method='GET',body?:unknown,idem?:string)=>fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(token?{Authorization:'Bearer '+token}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
  async function login(suffix:string){const r=await request('/auth/development/login',undefined,'POST',{subject:prefix+suffix});assert.equal(r.status,200);const t=await r.json() as Tokens;if(!users.includes(t.userId))users.push(t.userId);return t;}
  async function get(id:string,token:string){const r=await request('/parked-locations/'+id,token);assert.equal(r.status,200,await r.clone().text());return await r.json() as Location;}
  const root='/parked-locations';
  try{
    for(const [i,id] of lotIds.entries())await db.$transaction(async tx=>{
      const s=structuredClone(fixture.snapshot);if(i)s.parkingSpaces![0]!.id='foreign-space';
      await tx.parkingLot.create({data:{id,code:prefix+'-'+i,currentVersion:1}});await writeRevision(tx,id,1,s);
    });
    const alice=await login('-a'),bob=await login('-b'),alice2=await login('-a');
    const input:LocationCreateDto={clientRecordId:'first',lotId:lotIds[0]!,structureVersion:null,floorId:null,zoneId:null,parkingSpaceId:null,confidence:'LOW',distanceM:null,occurredAt:'2026-01-01T12:00:00Z',source:'SYNTHETIC'};
    await error(await request(root,undefined,'POST',input,'unauth'),401);
    const disabled=await createApp(readConfig({...env,DEV_LOCATIONS_ENABLED:'false'}),()=>{});await disabled.listen(0,'127.0.0.1');
    try{await error(await fetch(await disabled.getUrl()+'/api/v1'+root,{method:'POST',headers:{Authorization:'Bearer '+alice.accessToken,'Content-Type':'application/json','Idempotency-Key':'disabled'},body:JSON.stringify(input)}),403,'LOCATIONS_POLICY_DISABLED');}finally{await disabled.close();}
    assert.equal((await (await request(root+'/current',alice.accessToken)).json() as {location:null}).location,null);
    const created=await Promise.all([request(root,alice.accessToken,'POST',input,'create'),request(root,alice.accessToken,'POST',input,'create')]);assert.deepEqual(created.map(r=>r.status),[201,201]);
    const first=await created[0]!.json() as Receipt;assert.deepEqual(first,await created[1]!.json());assert.equal(created.filter(r=>r.headers.get('Idempotency-Replayed')==='true').length,1);
    const cross=await request(root,alice2.accessToken,'POST',{...input,occurredAt:'2026-01-01T12:00:00.000Z'},'reauth');assert.equal(cross.status,201);assert.deepEqual(await cross.json(),first);assert.equal(cross.headers.get('Idempotency-Replayed'),'true');
    await error(await request(root,alice.accessToken,'POST',{...input,distanceM:1},'different'),409,'RECORD_CONFLICT');
    await error(await request(root,alice.accessToken,'POST',{...input,distanceM:1},'create'),409,'IDEMPOTENCY_CONFLICT');
    const selected={...input,clientRecordId:'selected',structureVersion:1,floorId:'ground',zoneId:'ground-a',parkingSpaceId:'ground-s01',confidence:'MEDIUM',distanceM:12.125,occurredAt:'2026-01-03T12:00:00Z',note:'synthetic-selected-note'};
    const sr=await request(root,alice.accessToken,'POST',selected,'selected');assert.equal(sr.status,201);const second=await sr.json() as Receipt;
    const late=await request(root,alice.accessToken,'POST',{...input,clientRecordId:'late',occurredAt:'2025-01-01T00:00:00Z'},'late');assert.equal(late.status,201);
    assert.equal((await (await request(root+'/current',alice.accessToken)).json() as {location:Location}).location.id,second.locationId);
    const other=await request(root,bob.accessToken,'POST',input,'create');assert.equal(other.status,201);assert.notEqual((await other.json() as Receipt).locationId,first.locationId);
    await db.user.update({where:{id:bob.userId},data:{role:'ADMIN'}});
    for(const action of [()=>request(root+'/'+first.locationId,bob.accessToken),()=>request(root+'/'+first.locationId+'/history',bob.accessToken),()=>request(root+'/'+first.locationId,bob.accessToken,'PATCH',{expectedVersion:1,note:'foreign'},'foreign-patch'),()=>request(root+'/'+first.locationId,bob.accessToken,'DELETE',{expectedVersion:1},'foreign-delete')])await error(await action(),404);
    const patched=await request(root+'/'+first.locationId,alice.accessToken,'PATCH',{expectedVersion:1,structureVersion:1,floorId:'ground',zoneId:'ground-a',parkingSpaceId:'ground-s01',note:'synthetic-manual-note'},'correct');assert.equal(patched.status,200);
    const corrected=await get(first.locationId,alice.accessToken);assert.equal(corrected.original.structureVersion,null);assert.equal(corrected.selection.parkingSpaceId,'ground-s01');assert.equal(corrected.confidence,'LOW');assert.equal(corrected.userEdited,true);
    const changes=await Promise.all([request(root+'/'+first.locationId,alice.accessToken,'PATCH',{expectedVersion:2,note:'synthetic-race-a'},'race-a'),request(root+'/'+first.locationId,alice2.accessToken,'PATCH',{expectedVersion:2,note:'synthetic-race-b'},'race-b')]);assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
    assert.deepEqual(await (await request(root,alice2.accessToken,'POST',input,'create')).json(),first);assert.equal((await get(first.locationId,alice.accessToken)).version,3);
    const historyResponse=await request(root+'/'+first.locationId+'/history?limit=1',alice.accessToken),history=await historyResponse.json() as {items:{version:number;before:unknown;after:unknown}[];nextBeforeVersion:number|null};assert.equal(history.items[0]!.version,3);assert.equal(history.nextBeforeVersion,3);
    assert.equal((await (await request(root+'/'+first.locationId+'/history?limit=1&beforeVersion=3',alice.accessToken)).json() as typeof history).items[0]!.version,2);
    const page=await (await request(root+'?limit=1',alice.accessToken)).json() as {items:Location[];nextCursor:string};assert.equal(page.items[0]!.id,second.locationId);assert.ok(page.nextCursor);
    const p2=await (await request(root+'?limit=1&cursor='+page.nextCursor,alice.accessToken)).json() as typeof page;assert.equal(p2.items[0]!.id,first.locationId);await error(await request(root+'?limit=1&cursor='+page.nextCursor,bob.accessToken),400,'INVALID_LOCATION_CURSOR');
    for(const patch of [{structureVersion:null,floorId:'ground'},{structureVersion:1,zoneId:'ground-a'},{structureVersion:1,floorId:'ground',zoneId:'ground-a',parkingSpaceId:'foreign-space'},{structureVersion:1,floorId:'ground',zoneId:'basement-a'},{structureVersion:99}])await error(await request(root,alice.accessToken,'POST',{...input,...patch,clientRecordId:randomUUID()},randomUUID()),422);
    for(const patch of [{source:'APP_REPORTED'},{rawSignals:[1]},{confidence:'VALIDATED'},{distanceM:-1}])await error(await request(root,alice.accessToken,'POST',{...input,...patch,clientRecordId:randomUUID()},randomUUID()),400);
    await error(await request(root,alice.accessToken,'POST',{...input,clientRecordId:'future',occurredAt:new Date(Date.now()+86400000).toISOString()},'future'),422,'INVALID_LOCATION_TIME');
    await error(await request(root+'/'+first.locationId,alice.accessToken,'PATCH',{expectedVersion:3},'empty'),400,'EMPTY_LOCATION_PATCH');
    await error(await request(root,alice.accessToken,'POST',{...input,note:'x'.repeat(70000)},'big'),413);
    await db.user.update({where:{id:alice.userId},data:{role:'ADMIN'}});
    const edited=structuredClone(fixture.snapshot);edited.parkingSpaces![0]!.active=false;edited.parkingSpaces![0]!.label='v2-001';
    assert.equal((await request('/admin/lots/'+lotIds[0],alice.accessToken,'PUT',{expectedVersion:1,snapshot:edited},'map-edit')).status,200);
    const preserved=await get(second.locationId,alice.accessToken);assert.equal(preserved.selection.parkingSpace!.label,fixture.snapshot.parkingSpaces![0]!.label);
    await error(await request(root+'/'+second.locationId,alice.accessToken,'PATCH',{expectedVersion:1,structureVersion:2},'inactive-space'),422,'PARKING_SPACE_INACTIVE');
    const png=await sharp(randomBytes(256*256*3),{raw:{width:256,height:256,channels:3}}).png().toBuffer();assert.ok(png.length>65536);
    const photoInput={expectedVersion:3,contentType:'image/png',dataBase64:png.toString('base64')};
    await error(await request(root+'/'+first.locationId+'/photos',bob.accessToken,'POST',photoInput,'foreign-photo'),404);
    await error(await request(root+'/'+first.locationId+'/photos',alice.accessToken,'POST',{...photoInput,dataBase64:'PHN2Zz48L3N2Zz4='},'fake-image'),422,'INVALID_IMAGE');
    const uploaded=await request(root+'/'+first.locationId+'/photos',alice.accessToken,'POST',photoInput,'photo');assert.equal(uploaded.status,201,await uploaded.clone().text());const photoReceipt=await uploaded.json() as Receipt;
    assert.deepEqual(await (await request(root+'/'+first.locationId+'/photos',alice2.accessToken,'POST',photoInput,'photo')).json(),photoReceipt);
    const imageResponse=await request(root+'/'+first.locationId+'/photos/'+photoReceipt.photoId,alice.accessToken);assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('cache-control'),'no-store');assert.equal(imageResponse.headers.get('content-type'),'image/jpeg');assert.equal(imageResponse.headers.get('x-content-type-options'),'nosniff');const bytes=Buffer.from(await imageResponse.arrayBuffer());assert.equal((await sharp(bytes).metadata()).exif,undefined);
    await error(await request(root+'/'+first.locationId+'/photos/'+photoReceipt.photoId,bob.accessToken),404);
    await db.$executeRawUnsafe(`CREATE FUNCTION test_photo_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic storage failure'; END $$`);await db.$executeRawUnsafe('CREATE TRIGGER test_photo_failure BEFORE INSERT ON "PrivatePhotoBlob" FOR EACH ROW EXECUTE FUNCTION test_photo_failure()');
    try{await error(await request(root+'/'+first.locationId+'/photos',alice.accessToken,'POST',{...photoInput,expectedVersion:4},'photo-retry'),500,'INTERNAL_ERROR');}finally{await db.$executeRawUnsafe('DROP TRIGGER test_photo_failure ON "PrivatePhotoBlob"');await db.$executeRawUnsafe('DROP FUNCTION test_photo_failure()');}
    assert.equal((await get(first.locationId,alice.accessToken)).version,4);assert.equal(await db.locationPhoto.count({where:{locationId:first.locationId}}),1);assert.equal(await db.locationMutation.count({where:{userId:alice.userId,key:'photo-retry'}}),0);
    const retried=await request(root+'/'+first.locationId+'/photos',alice.accessToken,'POST',{...photoInput,expectedVersion:4},'photo-retry');assert.equal(retried.status,201);const retryPhoto=await retried.json() as Receipt;
    for(let version=5;version<8;version++)assert.equal((await request(root+'/'+first.locationId+'/photos',alice.accessToken,'POST',{...photoInput,expectedVersion:version},'extra-'+version)).status,201);
    await error(await request(root+'/'+first.locationId+'/photos',alice.accessToken,'POST',{...photoInput,expectedVersion:8},'sixth'),409,'LOCATION_PHOTO_LIMIT');
    const removedPhoto=await request(root+'/'+first.locationId+'/photos/'+photoReceipt.photoId,alice.accessToken,'DELETE',{expectedVersion:8},'photo-delete');assert.equal(removedPhoto.status,200);const removedPhotoBody=await removedPhoto.json();assert.deepEqual(await (await request(root+'/'+first.locationId+'/photos/'+photoReceipt.photoId,alice.accessToken,'DELETE',{expectedVersion:8},'photo-delete')).json(),removedPhotoBody);
    await error(await request(root+'/'+first.locationId+'/photos/'+photoReceipt.photoId,alice.accessToken),404);assert.equal(await db.privatePhotoBlob.count({where:{photoId:photoReceipt.photoId}}),0);
    await app.close();app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');base=await app.getUrl();db=app.get(DatabaseService).client;
    assert.equal((await get(first.locationId,alice.accessToken)).version,9);assert.equal((await request(root+'/'+first.locationId+'/photos/'+retryPhoto.photoId,alice.accessToken)).status,200);
    const pair=await (await request('/auth/vehicle-links',undefined,'POST',{})).json() as {installationId:string;deviceCode:string;userCode:string};installations.push(pair.installationId);assert.equal((await request('/auth/vehicle-links/approve',alice.accessToken,'POST',{userCode:pair.userCode})).status,200);const vehicle=await (await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:pair.deviceCode})).json() as Tokens;
    const sessionInput=JSON.parse(await readFile('docs/examples/session-request.json','utf8')) as {installationId:string;capabilities:Record<string,{checkedAt:string}>};sessionInput.installationId=pair.installationId;for(const v of Object.values(sessionInput.capabilities))v.checkedAt=new Date().toISOString();
    const vs=await request('/vehicle-sessions',vehicle.accessToken,'POST',sessionInput,'vehicle-session');assert.equal(vs.status,201);const session=await vs.json() as {id:string};
    const close={contractVersion:'1.0',eventId:'close',sequence:1,occurredAt:new Date().toISOString(),type:'SESSION_CLOSED',payload:{reason:'USER_ENDED'}};assert.equal((await request('/vehicle-sessions/'+session.id+'/events',vehicle.accessToken,'POST',close,'close')).status,201);
    const linkedInput={...input,clientRecordId:'vehicle-record',vehicleSessionId:session.id,occurredAt:'2026-01-04T00:00:00Z'};const linked=await request(root,vehicle.accessToken,'POST',linkedInput,'vehicle-location');assert.equal(linked.status,201);const linkedReceipt=await linked.json() as Receipt;
    await error(await request(root,alice.accessToken,'POST',{...linkedInput,clientRecordId:'web-with-session'},'web-session'),403,'VEHICLE_SESSION_REQUIRED');
    assert.equal((await request('/auth/vehicle-links/'+pair.installationId,alice.accessToken,'DELETE')).status,204);
    await error(await request(root+'/'+first.locationId+'/photos/'+retryPhoto.photoId,vehicle.accessToken),401);assert.equal((await request(root+'/'+first.locationId+'/photos/'+retryPhoto.photoId,alice.accessToken)).status,200);
    const captured=await get(first.locationId,alice.accessToken),listCapture=await (await request(root+'?limit=20',alice.accessToken)).json();
    const deleted=await request(root+'/'+first.locationId,alice.accessToken,'DELETE',{expectedVersion:9},'delete-location');assert.equal(deleted.status,200);const deletedBody=await deleted.json() as Receipt;assert.equal(deletedBody.accessEpoch,2);assert.deepEqual(await (await request(root+'/'+first.locationId,alice2.accessToken,'DELETE',{expectedVersion:9},'delete-location')).json(),deletedBody);
    for(const path of [root+'/'+first.locationId,root+'/'+first.locationId+'/history',root+'/'+first.locationId+'/photos/'+retryPhoto.photoId])await error(await request(path,alice.accessToken),404);
    assert.equal(await db.privatePhotoBlob.count({where:{photo:{locationId:first.locationId}}}),0);assert.equal(await db.locationChange.count({where:{locationId:first.locationId}}),0);assert.equal(await db.locationPhoto.count({where:{locationId:first.locationId}}),0);
    assert.equal((await db.parkedLocation.findUniqueOrThrow({where:{id:first.locationId}})).note,null);
    await error(await request(root,alice.accessToken,'POST',input,'create'),409,'RESOURCE_DELETED');await error(await request(root,alice.accessToken,'POST',input,'new-after-delete'),409,'RESOURCE_DELETED');
    assert.equal((await request(root+'/'+linkedReceipt.locationId,alice.accessToken,'DELETE',{expectedVersion:1},'delete-current')).status,200);assert.equal((await (await request(root+'/current',alice.accessToken)).json() as {location:Location}).location.id,second.locationId);
    const rateKey=createHash('sha256').update('locations-read:'+alice.userId).digest('hex');await db.$executeRaw`INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES (${rateKey},NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300`;const limited=await request(root,alice.accessToken);await error(limited,429,'RATE_LIMITED');assert.equal(limited.headers.get('retry-after'),'300');
    await request('/auth/logout',bob.accessToken,'POST');await error(await request(root,bob.accessToken),401);
    for(const value of [alice.accessToken,bob.accessToken,vehicle.accessToken,key,'synthetic-manual-note',first.locationId,png.toString('base64').slice(0,100)])assert.ok(!JSON.stringify(logs).includes(value));
    if(process.env.LOCATIONS_CAPTURE_DIR)for(const [name,value] of Object.entries({'location-receipt.json':first,'location-private.json':captured,'location-page.json':listCapture,'location-history.json':history,'location-photo-receipt.json':photoReceipt,'location-deleted.json':deletedBody}))await writeFile(process.env.LOCATIONS_CAPTURE_DIR+'/'+name,JSON.stringify(value,null,2));
  }finally{
    try{
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_photo_failure ON "PrivatePhotoBlob"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_photo_failure()');
      await db.locationMutation.deleteMany({where:{userId:{in:users}}});await db.privatePhotoBlob.deleteMany({where:{photo:{location:{userId:{in:users}}}}});await db.locationPhoto.deleteMany({where:{location:{userId:{in:users}}}});await db.locationChange.deleteMany({where:{location:{userId:{in:users}}}});await db.parkedLocation.deleteMany({where:{userId:{in:users}}});
      await db.lotMutation.deleteMany({where:{authSession:{userId:{in:users}}}});await db.vehicleEvent.deleteMany({where:{session:{userId:{in:users}}}});await db.vehicleSession.deleteMany({where:{userId:{in:users}}});
      await db.parkingSpace.deleteMany({where:{lotId:{in:lotIds}}});await db.lotDriveAisle.deleteMany({where:{lotId:{in:lotIds}}});await db.lotPillar.deleteMany({where:{lotId:{in:lotIds}}});await db.lotRamp.deleteMany({where:{lotId:{in:lotIds}}});await db.lotEntrance.deleteMany({where:{lotId:{in:lotIds}}});await db.lotZone.deleteMany({where:{lotId:{in:lotIds}}});await db.lotFloor.deleteMany({where:{lotId:{in:lotIds}}});await db.lotRevision.deleteMany({where:{lotId:{in:lotIds}}});await db.parkingLot.deleteMany({where:{id:{in:lotIds}}});
      await db.vehiclePairing.deleteMany({where:{installationId:{in:installations}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.installation.deleteMany({where:{id:{in:installations}}});await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();
    }finally{await app.close();}
  }
});
