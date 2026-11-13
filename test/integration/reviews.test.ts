import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { writeRevision } from '../../src/lots/store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import { provisionSyntheticVisit } from '../../src/reviews/visit-seed.js';
import type { ReviewRating } from '../../src/reviews/dto.js';

test('real PG reviews: ownership, opt-in, retries/concurrency/rollback/rebuild, suppression and all difficulty adapters',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const key='synthetic-reviews-development-key-000001',prefix=randomUUID(),logs:Record<string,string|number>[]=[];
  const env={...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key,DEV_REVIEWS_ENABLED:'true'};
  const app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');const base=await app.getUrl(),db=app.get(DatabaseService).client;
  const fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto;
  const lotIds=[randomUUID(),randomUUID()],users:string[]=[],installations:string[]=[];
  const snapshot={...fixture.snapshot,latitude:35,longitude:90};
  type Token={userId:string;accessToken:string;sessionId:string};type Receipt={reviewId:string;version:number;deleted:boolean;aggregateVersion:number};
  type Score={score:number|null;baseScore:number|null;reviewAggregation:{status:string;sampleCount:number|null;version:number|null};factors:{name:string;status:string;score:number|null;sampleCount:number|null}[];coverage:{availableWeight:number}};
  const request=(path:string,token?:string,method='GET',body?:unknown,idem?:string)=>fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(token?{Authorization:'Bearer '+token}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  async function login(i:number){const r=await request('/auth/development/login',undefined,'POST',{subject:prefix+'-'+i});assert.equal(r.status,200);const t=await r.json() as Token;if(!users.includes(t.userId))users.push(t.userId);return t;}
  async function error(r:Response,status:number,code?:string){assert.equal(r.status,status,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);}
  const aggregatePath='/lots/'+lotIds[0]+'/reviews/aggregate',scorePath='/lots/'+lotIds[0]+'/difficulty?asOfYear=2026';
  try{
    for(const [i,id] of lotIds.entries())await db.$transaction(async tx=>{await tx.parkingLot.create({data:{id,code:prefix+'-'+i,currentVersion:1}});await writeRevision(tx,id,1,{...snapshot,longitude:90+i*.001});});
    const tokens=await Promise.all(Array.from({length:6},(_,i)=>login(i)));
    const visits=await Promise.all(tokens.map(t=>provisionSyntheticVisit(db,t.userId,lotIds[0]!,1,{...env,ALLOW_SYNTHETIC_REVIEW_VISIT:'true'})));
    assert.equal((await provisionSyntheticVisit(db,tokens[0]!.userId,lotIds[0]!,1,{...env,ALLOW_SYNTHETIC_REVIEW_VISIT:'true'})).id,visits[0]!.id);
    await assert.rejects(provisionSyntheticVisit(db,tokens[0]!.userId,lotIds[0]!,1,env));
    await assert.rejects(db.reviewVisit.update({where:{id:visits[0]!.id},data:{source:'APP_REPORTED'}}));
    const cliVisit=JSON.parse(execFileSync(process.execPath,['dist/reviews/visit-seed.js'],{encoding:'utf8',env:{...env,ALLOW_SYNTHETIC_REVIEW_VISIT:'true',SYNTHETIC_REVIEW_USER_ID:tokens[0]!.userId,SYNTHETIC_REVIEW_LOT_ID:lotIds[0],SYNTHETIC_REVIEW_LOT_VERSION:'1'}})) as {visitId:string};assert.equal(cliVisit.visitId,visits[0]!.id);
    const alice=tokens[0]!,rating:ReviewRating[]=['HARD','HARD','NORMAL','EASY','EASY'];
    const input=(i:number)=>({lotId:lotIds[0],lotVersion:1,visitId:visits[i]!.id,rating:rating[i]??'NORMAL'});
    const disabled=await createApp(readConfig({...env,DEV_REVIEWS_ENABLED:'false'}),()=>{});await disabled.listen(0,'127.0.0.1');
    try{const r=await fetch(await disabled.getUrl()+'/api/v1/reviews',{method:'POST',headers:{Authorization:'Bearer '+alice.accessToken,'Content-Type':'application/json','Idempotency-Key':'disabled'},body:JSON.stringify(input(0))});await error(r,403,'REVIEWS_POLICY_DISABLED');}finally{await disabled.close();}
    await error(await request('/reviews',undefined,'POST',input(0),'unauth'),401);
    await error(await request('/reviews',tokens[1]!.accessToken,'POST',input(0),'foreign'),404);
    await error(await request('/reviews',alice.accessToken,'POST',{...input(0),lotId:lotIds[1]},'mismatch'),404);
    for(const patch of [{rating:'INVALID'},{rawSignals:[1]},{drivingSummary:{}},{source:'OBSERVED'},{userId:alice.userId},{rating:null}])await error(await request('/reviews',alice.accessToken,'POST',{...input(0),...patch},'invalid'),400);
    await error(await request('/reviews',alice.accessToken,'POST',input(0)),400,'INVALID_IDEMPOTENCY_KEY');
    const beforePage=await (await request('/lots?latitude=35&longitude=90&limit=1&asOfYear=2026',alice.accessToken)).json() as {nextCursor:string};assert.ok(beforePage.nextCursor);
    const submissions=await Promise.all([request('/reviews',alice.accessToken,'POST',input(0),'create'),request('/reviews',alice.accessToken,'POST',input(0),'create')]);assert.deepEqual(submissions.map(x=>x.status),[201,201]);
    const first=await submissions[0]!.json() as Receipt;assert.deepEqual(first,await submissions[1]!.json());assert.equal(submissions.filter(r=>r.headers.get('Idempotency-Replayed')==='true').length,1);
    assert.equal(await db.review.count({where:{visitId:visits[0]!.id}}),1);
    const small=await (await request(aggregatePath,alice.accessToken)).json() as Record<string,unknown>;assert.equal(small.sampleCount,1);assert.equal(small.score,null);assert.equal(small.privacyStatus,'DEVELOPMENT_ONLY_NOT_ANONYMIZED');
    const insufficient=await (await request(scorePath,alice.accessToken)).json() as Score;assert.equal(insufficient.factors[1]!.status,'INSUFFICIENT_SAMPLES');assert.equal(insufficient.factors[1]!.score,null);assert.equal(insufficient.baseScore,2.254545);
    await error(await request('/lots?latitude=35&longitude=90&limit=1&asOfYear=2026&cursor='+beforePage.nextCursor,alice.accessToken),409,'SEARCH_CHANGED');
    await error(await request('/reviews',alice.accessToken,'POST',{...input(0),rating:'EASY'},'create'),409,'IDEMPOTENCY_CONFLICT');
    const secondSession=await login(0);await error(await request('/reviews',secondSession.accessToken,'POST',input(0),'different-key'),409,'REVIEW_ALREADY_EXISTS');
    const receipts=[first];
    for(let i=1;i<5;i++){const r=await request('/reviews',tokens[i]!.accessToken,'POST',input(i),'create');assert.equal(r.status,201);receipts.push(await r.json() as Receipt);}
    const ready=await (await request(aggregatePath,alice.accessToken)).json() as Record<string,unknown>;assert.equal(ready.sampleCount,5);assert.equal(ready.score,3);assert.equal(ready.status,'READY');
    for(const forbidden of ['userId','visitId','reviewId','authSessionId','installationId','scoreSum'])assert.ok(!Object.keys(ready).includes(forbidden));
    const scored=await (await request(scorePath,alice.accessToken)).json() as Score;assert.equal(scored.factors[1]!.status,'INCLUDED');assert.equal(scored.factors[1]!.sampleCount,5);assert.equal(scored.coverage.availableWeight,.8);assert.equal(scored.baseScore,2.4875);
    const detail=await (await request('/lots/'+lotIds[0]+'?asOfYear=2026',alice.accessToken)).json() as {difficulty:Score};assert.deepEqual(detail.difficulty,scored);
    const page=await (await request('/lots?latitude=35&longitude=90&asOfYear=2026&sort=EASIEST',alice.accessToken)).json() as {items:{id:string;difficulty:Score}[]};assert.equal(page.items.find(x=>x.id===lotIds[0])!.difficulty.reviewAggregation.version,scored.reviewAggregation.version);
    const privateResponse=await request('/reviews/'+first.reviewId,alice.accessToken);const privateBody=await privateResponse.json() as Record<string,unknown>;assert.equal(privateBody.rating,'HARD');assert.ok(!('userId' in privateBody));
    await error(await request('/reviews/'+first.reviewId,tokens[1]!.accessToken),404);
    await error(await request('/reviews/'+first.reviewId,tokens[1]!.accessToken,'PUT',{expectedVersion:1,rating:'EASY'},'foreign-update'),404);
    assert.deepEqual((await (await request('/reviews/me?lotId='+lotIds[0]+'&lotVersion=1',alice.accessToken)).json() as {review:unknown}).review,privateBody);
    const changes=await Promise.all(['EASY','NORMAL'].map((r,i)=>request('/reviews/'+first.reviewId,alice.accessToken,'PUT',{expectedVersion:1,rating:r},'race-'+i)));assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
    const aggregateBefore=await db.reviewAggregate.findUniqueOrThrow({where:{lotId_lotVersion:{lotId:lotIds[0]!,lotVersion:1}}});
    await db.$executeRawUnsafe(`CREATE FUNCTION test_review_aggregate_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic aggregate failure'; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_review_failure BEFORE UPDATE ON "ReviewAggregate" FOR EACH ROW EXECUTE FUNCTION test_review_aggregate_failure()');
    try{await error(await request('/reviews/'+first.reviewId,alice.accessToken,'PUT',{expectedVersion:2,rating:'HARD'},'retry-after-failure'),500,'INTERNAL_ERROR');}finally{await db.$executeRawUnsafe('DROP TRIGGER test_review_failure ON "ReviewAggregate"');await db.$executeRawUnsafe('DROP FUNCTION test_review_aggregate_failure()');}
    assert.equal((await db.review.findUniqueOrThrow({where:{id:first.reviewId}})).version,2);assert.equal(await db.reviewMutation.count({where:{authSessionId:alice.sessionId,key:'retry-after-failure'}}),0);
    assert.deepEqual(await db.reviewAggregate.findUniqueOrThrow({where:{lotId_lotVersion:{lotId:lotIds[0]!,lotVersion:1}}}),aggregateBefore);
    const retried=await request('/reviews/'+first.reviewId,alice.accessToken,'PUT',{expectedVersion:2,rating:'HARD'},'retry-after-failure');assert.equal(retried.status,200);const retryBody=await retried.json() as Receipt;
    assert.deepEqual(await (await request('/reviews/'+first.reviewId,alice.accessToken,'PUT',{expectedVersion:2,rating:'HARD'},'retry-after-failure')).json(),retryBody);
    const rebuild='/admin/lots/'+lotIds[0]+'/revisions/1/review-aggregate/rebuild';await error(await request(rebuild,alice.accessToken,'POST',{ruleVersion:'reviews-v1'},'rebuild'),403);
    await db.user.update({where:{id:alice.userId},data:{role:'ADMIN'}});
    await db.reviewAggregate.update({where:{lotId_lotVersion:{lotId:lotIds[0]!,lotVersion:1}},data:{scoreSum:5n}});
    const rebuilt=await Promise.all([request(rebuild,alice.accessToken,'POST',{ruleVersion:'reviews-v1'},'rebuild'),request(rebuild,alice.accessToken,'POST',{ruleVersion:'reviews-v1'},'rebuild')]);assert.deepEqual(rebuilt.map(r=>r.status),[201,201]);assert.deepEqual(await rebuilt[0]!.json(),await rebuilt[1]!.json());
    assert.equal((await db.reviewAggregate.findUniqueOrThrow({where:{lotId_lotVersion:{lotId:lotIds[0]!,lotVersion:1}}})).scoreSum,15n);
    const fifth=receipts[4]!,remove=await request('/reviews/'+fifth.reviewId,tokens[4]!.accessToken,'DELETE',{expectedVersion:1},'delete');assert.equal(remove.status,200);const removed=await remove.json();
    assert.deepEqual(await (await request('/reviews/'+fifth.reviewId,tokens[4]!.accessToken,'DELETE',{expectedVersion:1},'delete')).json(),removed);
    await error(await request('/reviews/'+fifth.reviewId,tokens[4]!.accessToken),404);await error(await request('/reviews',tokens[4]!.accessToken,'POST',input(4),'recreate'),409,'REVIEW_DELETED');
    assert.equal((await db.review.findUniqueOrThrow({where:{id:fifth.reviewId}})).rating,null);
    const afterDelete=await (await request(scorePath,alice.accessToken)).json() as Score;assert.equal(afterDelete.reviewAggregation.sampleCount,4);assert.equal(afterDelete.factors[1]!.status,'INSUFFICIENT_SAMPLES');assert.equal(afterDelete.baseScore,2.254545);
    const afterReplay=await request('/reviews',tokens[4]!.accessToken,'POST',input(4),'create');assert.equal(afterReplay.status,201);assert.equal(afterReplay.headers.get('Idempotency-Replayed'),'true');await error(await request('/reviews/'+fifth.reviewId,tokens[4]!.accessToken),404);assert.equal((await db.reviewAggregate.findUniqueOrThrow({where:{lotId_lotVersion:{lotId:lotIds[0]!,lotVersion:1}}})).sampleCount,4);
    const pair=await (await request('/auth/vehicle-links',undefined,'POST',{})).json() as {installationId:string;deviceCode:string;userCode:string};installations.push(pair.installationId);
    assert.equal((await request('/auth/vehicle-links/approve',alice.accessToken,'POST',{userCode:pair.userCode})).status,200);const vehicle=await (await request('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:pair.deviceCode})).json() as Token;
    assert.equal((await request('/reviews/'+first.reviewId,vehicle.accessToken)).status,200);await error(await request(rebuild,vehicle.accessToken,'POST',{ruleVersion:'reviews-v1'},'vehicle-admin'),403);
    const edit=await request('/admin/lots/'+lotIds[0],alice.accessToken,'PUT',{expectedVersion:1,snapshot},'new-structure');assert.equal(edit.status,200);
    const newScore=await (await request(scorePath,alice.accessToken)).json() as Score;assert.equal(newScore.reviewAggregation.status,'NO_SAMPLES');assert.equal(newScore.reviewAggregation.sampleCount,0);
    assert.equal((await (await request(scorePath+'&lotVersion=1',alice.accessToken)).json() as Score).reviewAggregation.sampleCount,4);
    assert.equal((await request('/admin/lots/'+lotIds[0],alice.accessToken,'PUT',{expectedVersion:2,snapshot:{...snapshot,active:false}},'disable')).status,200);
    await error(await request(aggregatePath+'?lotVersion=1',alice.accessToken),404);await error(await request('/reviews/'+receipts[1]!.reviewId,tokens[1]!.accessToken,'PUT',{expectedVersion:1,rating:'EASY'},'inactive'),404);
    assert.equal((await request('/reviews/'+first.reviewId,alice.accessToken,'DELETE',{expectedVersion:3},'delete-inactive')).status,200);
    const rateKey=createHash('sha256').update('review-read:'+tokens[2]!.sessionId).digest('hex');
    await db.$executeRaw`INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES (${rateKey},NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300`;
    const limited=await request('/reviews/'+receipts[2]!.reviewId,tokens[2]!.accessToken);await error(limited,429,'RATE_LIMITED');assert.equal(limited.headers.get('Retry-After'),'300');
    await request('/auth/logout',tokens[1]!.accessToken,'POST');await error(await request('/reviews/'+receipts[1]!.reviewId,tokens[1]!.accessToken),401);
    for(const secret of [key,alice.accessToken,vehicle.accessToken,...users,...visits.map(v=>v.id),'rating','rawSignals'])assert.ok(!JSON.stringify(logs).includes(secret));
    if(process.env.REVIEWS_CAPTURE_DIR)for(const [name,value] of Object.entries({'review-receipt.json':first,'review-private.json':privateBody,'review-aggregate.json':ready,'review-difficulty.json':scored}))await writeFile(process.env.REVIEWS_CAPTURE_DIR+'/'+name,JSON.stringify(value,null,2));
  }finally{
    try{
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_review_failure ON "ReviewAggregate"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_review_aggregate_failure()');
      await db.reviewMutation.deleteMany({where:{authSession:{userId:{in:users}}}});await db.review.deleteMany({where:{visit:{userId:{in:users}}}});await db.reviewVisit.deleteMany({where:{userId:{in:users}}});await db.reviewAggregate.deleteMany({where:{lotId:{in:lotIds}}});
      await db.lotMutation.deleteMany({where:{authSession:{userId:{in:users}}}});
      await db.parkingSpace.deleteMany({where:{lotId:{in:lotIds}}});await db.lotDriveAisle.deleteMany({where:{lotId:{in:lotIds}}});await db.lotPillar.deleteMany({where:{lotId:{in:lotIds}}});await db.lotRamp.deleteMany({where:{lotId:{in:lotIds}}});await db.lotEntrance.deleteMany({where:{lotId:{in:lotIds}}});await db.lotZone.deleteMany({where:{lotId:{in:lotIds}}});await db.lotFloor.deleteMany({where:{lotId:{in:lotIds}}});await db.lotRevision.deleteMany({where:{lotId:{in:lotIds}}});await db.parkingLot.deleteMany({where:{id:{in:lotIds}}});
      await db.vehiclePairing.deleteMany({where:{installationId:{in:installations}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.installation.deleteMany({where:{id:{in:installations}}});await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();
    }finally{await app.close();}
  }
});
