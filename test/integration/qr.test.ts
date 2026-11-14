import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile,writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM,CookieJar } from 'jsdom';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { writeRevision } from '../../src/lots/store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import { hash,QR_TTL_MS,secret } from '../../src/qr/security.js';

test('real PG first journey and QR: one-time exchange, bound retry, expiry, issuer/owner revocation and minimal phone view',async()=>{
  execFileSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{stdio:'pipe'});
  const key='synthetic-qr-development-secret-000000001',prefix=randomUUID(),origin='https://qr.example.invalid',logs:Record<string,string|number>[]=[];
  const env={...process.env,NODE_ENV:'test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:key,DEV_LOCATIONS_ENABLED:'true',DEV_QR_ENABLED:'true',QR_PUBLIC_ORIGIN:origin};
  let app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');let base=await app.getUrl(),db=app.get(DatabaseService).client;
  const users:string[]=[],installations:string[]=[],lotId=randomUUID(),fixture=JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json','utf8')) as LotCreateDto;
  fixture.snapshot.name='<img src=x onerror=alert(1)> 가상 주차장';
  const names={challenge:'__Host-parksical-qr-challenge',session:'__Host-parksical-qr'};
  type Tokens={userId:string;sessionId:string;accessToken:string;installationId?:string};
  type Grant={grantId:string;url:string;expiresAt:string;policyStatus:string};
  type Phone={csrf:string;cookie:string};
  const api=(path:string,token?:string,method='GET',body?:unknown,idem?:string,extra:Record<string,string>={})=>fetch(base+'/api/v1'+path,{method,headers:{'Content-Type':'application/json','X-Development-Key':key,...(token?{Authorization:'Bearer '+token}:{}),...(idem?{'Idempotency-Key':idem}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});
  const status=async(r:Response,n:number,code?:string)=>{assert.equal(r.status,n,await r.clone().text());assert.equal(r.headers.get('cache-control'),'no-store');if(code)assert.equal((await r.json() as {error:{code:string}}).error.code,code);};
  const pairs=(r:Response)=>r.headers.getSetCookie().map(x=>x.split(';')[0]!).join('; ');
  async function login(suffix:string){const r=await api('/auth/development/login',undefined,'POST',{subject:prefix+suffix});assert.equal(r.status,200);const t=await r.json() as Tokens;if(!users.includes(t.userId))users.push(t.userId);return t;}
  async function bootstrap(){const r=await api('/qr/bootstrap',undefined,'POST',{},undefined,{Origin:origin});await status(r,200);assert.match(r.headers.get('set-cookie')!,/HttpOnly/);assert.match(r.headers.get('set-cookie')!,/SameSite=Strict/);assert.match(r.headers.get('set-cookie')!,/Secure/);return {csrf:(await r.json() as {csrfToken:string}).csrfToken,cookie:pairs(r)};}
  const exchange=(grant:Grant,phone:Phone,idem='exchange',extra:Record<string,string>={})=>api('/qr/exchanges',undefined,'POST',{token:new URL(grant.url).hash.slice(1)},idem,{Origin:origin,Cookie:phone.cookie,'X-CSRF-Token':phone.csrf,...extra});
  const view=(session:string,extra:Record<string,string>={})=>api('/qr/location',undefined,'GET',undefined,undefined,{Cookie:session,...extra});
  async function issue(token:string,locationId:string,version=1,idem:string=randomUUID()){const r=await api('/parked-locations/'+locationId+'/qr-tokens',token,'POST',{expectedVersion:version},idem);await status(r,201);return await r.json() as Grant;}
  async function redeem(grant:Grant){const phone=await bootstrap(),r=await exchange(grant,phone,randomUUID());await status(r,200);return {phone,session:pairs(r)};}
  try{
    await db.$transaction(async tx=>{await tx.parkingLot.create({data:{id:lotId,code:prefix,currentVersion:1}});await writeRevision(tx,lotId,1,fixture.snapshot);});
    const alice=await login('-a'),bob=await login('-b');
    const start=await api('/auth/vehicle-links',undefined,'POST',{}),pair=await start.json() as {installationId:string;deviceCode:string;userCode:string};installations.push(pair.installationId);
    await status(await api('/auth/vehicle-links/approve',alice.accessToken,'POST',{userCode:pair.userCode}),200);
    const linked=await api('/auth/vehicle-links/exchange',undefined,'POST',{deviceCode:pair.deviceCode});await status(linked,200);const vehicle=await linked.json() as Tokens;
    // Full first journey begins with actual authentication/link, catalog, structure and difficulty.
    const search=await api('/lots?latitude='+fixture.snapshot.latitude+'&longitude='+fixture.snapshot.longitude+'&radiusM=20000',vehicle.accessToken);assert.equal(search.status,200);assert.ok((await search.json() as {items:{id:string}[]}).items.some(x=>x.id===lotId));
    assert.equal((await api('/lots/'+lotId,vehicle.accessToken)).status,200);
    assert.equal((await api('/lots/'+lotId+'/difficulty?vehicleLengthMm=4800&vehicleWidthMm=1850',vehicle.accessToken)).status,200);
    const input={clientRecordId:'qr-journey',lotId,structureVersion:null,floorId:null,zoneId:null,parkingSpaceId:null,source:'SYNTHETIC',confidence:'LOW',distanceM:12.125,occurredAt:'2026-01-01T12:00:00Z',note:'private-note-never-in-phone'};
    const created=await api('/parked-locations',vehicle.accessToken,'POST',input,'local-record');await status(created,201);const location=await created.json() as {locationId:string;version:number};
    assert.deepEqual(await (await api('/parked-locations',vehicle.accessToken,'POST',input,'local-record')).json(),location);
    const root='/parked-locations/'+location.locationId;
    await status(await api(root,vehicle.accessToken,'PATCH',{expectedVersion:1,structureVersion:1,floorId:'ground',zoneId:'ground-a',parkingSpaceId:'ground-s01'},'manual'),200);
    await status(await api(root+'/qr-tokens',bob.accessToken,'POST',{expectedVersion:2},'foreign'),404);
    await status(await api(root+'/qr-tokens',alice.accessToken,'POST',{expectedVersion:1},'stale'),409,'VERSION_CONFLICT');
    const disabled=await createApp(readConfig({...env,DEV_QR_ENABLED:'false'}),()=>{});await disabled.listen(0,'127.0.0.1');
    try{const r=await fetch(await disabled.getUrl()+ '/api/v1'+root+'/qr-tokens',{method:'POST',headers:{Authorization:'Bearer '+alice.accessToken,'Content-Type':'application/json','Idempotency-Key':'off'},body:JSON.stringify({expectedVersion:2})});await status(r,403,'QR_POLICY_DISABLED');assert.equal((await fetch(await disabled.getUrl()+'/p')).status,403);}finally{await disabled.close();}
    const grant=await issue(vehicle.accessToken,location.locationId,2,'issue-first'),rawToken=new URL(grant.url).hash.slice(1);
    assert.equal(new URL(grant.url).pathname,'/p');assert.equal(new URL(grant.url).search,'');assert.equal(grant.policyStatus,'PROVISIONAL_D07');
    const stored=await db.qrAccessGrant.findUniqueOrThrow({where:{id:grant.grantId}});
    assert.equal(stored.tokenHash,hash(rawToken));assert.equal(stored.expiresAt.getTime()-stored.createdAt.getTime(),QR_TTL_MS);assert.ok(!JSON.stringify(stored).includes(rawToken));
    await status(await api(root+'/qr-tokens',vehicle.accessToken,'POST',{expectedVersion:2},'issue-first'),409,'QR_SECRET_ALREADY_ISSUED');
    for(const opts of [{},{method:'HEAD'},{headers:{Purpose:'prefetch','User-Agent':'synthetic-link-preview'}}]){
      const preview=await fetch(base+'/p',opts);assert.equal(preview.status,200);assert.equal(preview.headers.get('cache-control'),'no-store');assert.equal(preview.headers.get('referrer-policy'),'no-referrer');assert.match(preview.headers.get('content-security-policy')!,/frame-ancestors 'none'/);assert.equal(preview.headers.get('set-cookie'),null);assert.ok(!(await preview.text()).includes(rawToken));
    }
    assert.equal((await db.qrAccessGrant.findUniqueOrThrow({where:{id:grant.grantId}})).consumedAt,null);
    assert.equal(await db.qrPhoneSession.count(),0);
    await status(await api('/qr/bootstrap',undefined,'POST',{}),403,'QR_ORIGIN_REJECTED');
    const phoneA=await bootstrap(),phoneB=await bootstrap();
    await status(await exchange(grant,phoneA,'bad-origin',{Origin:origin+'.attacker.invalid'}),403,'QR_ORIGIN_REJECTED');
    await status(await exchange(grant,phoneA,'bad-site',{'Sec-Fetch-Site':'same-site'}),403,'QR_ORIGIN_REJECTED');
    await status(await exchange(grant,phoneA,'bad-csrf',{'X-CSRF-Token':'f'.repeat(64)}),403,'QR_CSRF_REJECTED');
    await db.$executeRawUnsafe("CREATE FUNCTION test_qr_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic qr storage failure'; END $$");
    await db.$executeRawUnsafe('CREATE TRIGGER test_qr_failure BEFORE INSERT ON "QrPhoneSession" FOR EACH ROW EXECUTE FUNCTION test_qr_failure()');
    try{await status(await exchange(grant,phoneA,'storage-retry'),500,'INTERNAL_ERROR');}finally{await db.$executeRawUnsafe('DROP TRIGGER test_qr_failure ON "QrPhoneSession"');await db.$executeRawUnsafe('DROP FUNCTION test_qr_failure()');}
    const rolledBack=await db.qrAccessGrant.findUniqueOrThrow({where:{id:grant.grantId}});assert.equal(rolledBack.consumedAt,null);assert.equal(rolledBack.exchangeHash,null);
    const race=await Promise.all([exchange(grant,phoneA,'race'),exchange(grant,phoneB,'race')]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    const winner=race[0]!.status===200?phoneA:phoneB,success=race.find(r=>r.status===200)!;
    const session=pairs(success),exchangeBody=await success.json();assert.ok(session.startsWith(names.session+'='));assert.ok(!JSON.stringify(exchangeBody).includes(rawToken));
    const retried=await exchange(grant,winner,'race');await status(retried,200);assert.equal(pairs(retried),session);assert.equal(retried.headers.get('Idempotency-Replayed'),'true');
    assert.equal(await db.qrPhoneSession.count({where:{grantId:grant.grantId}}),1);
    const read=await view(session);await status(read,200);const projection=await read.json() as {confidence:string;userEdited:boolean;lotName:string;floorLabel:string;map:{spaces:{selected:boolean}[];pillars:unknown[]}};
    assert.equal(projection.confidence,'LOW');assert.equal(projection.userEdited,true);assert.equal(projection.map.spaces.length,16);assert.equal(projection.map.spaces.filter(x=>x.selected).length,1);assert.equal(projection.map.pillars.length,6);
    for(const value of [alice.userId,vehicle.sessionId,location.locationId,'private-note-never-in-phone','clientRecordId','latitude','longitude','photos','note','installationId','basement'])assert.ok(!JSON.stringify(projection).includes(value),value);
    // Execute the actual served phone script against the actual HTTP API in a DOM.
    // This verifies UI events/state, not browser layout/CSP enforcement or physical phone behavior.
    const uiRecord=await api('/parked-locations',alice.accessToken,'POST',{...input,clientRecordId:'dom-ui',structureVersion:1,floorId:'ground',zoneId:'ground-a',parkingSpaceId:'ground-s01'},'ui-record');
    const uiId=(await uiRecord.json() as {locationId:string}).locationId,uiGrant=await issue(alice.accessToken,uiId);
    const htmlResponse=await fetch(base+'/p'),scriptResponse=await fetch(base+'/p/app.js'),cssResponse=await fetch(base+'/p/style.css');
    assert.equal(cssResponse.status,200);assert.match(cssResponse.headers.get('content-type')!,/text\/css/);
    const html=await htmlResponse.text(),script=await scriptResponse.text(),jar=new CookieJar(),doms:JSDOM[]=[];
    const until=async(check:()=>boolean)=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}assert.ok(check(),'phone DOM did not reach expected state');};
    function phoneDom(url:string){
      const dom=new JSDOM(html,{url,runScripts:'outside-only',pretendToBeVisual:true,cookieJar:jar});doms.push(dom);
      dom.window.fetch=async(input:RequestInfo|URL,options:RequestInit={})=>{
        const url=new URL(String(input),origin);assert.equal(url.origin,origin);
        const headers=new Headers(options.headers);headers.set('Origin',origin);headers.set('Sec-Fetch-Site','same-origin');headers.set('Cookie',jar.getCookieStringSync(url.href,{http:true}));
        const r=await fetch(base+url.pathname+url.search,{...options,headers});
        for(const c of r.headers.getSetCookie())jar.setCookieSync(c,url.href,{http:true});
        return r;
      };
      dom.window.eval(script);return dom;
    }
    const element=(dom:JSDOM,id:string)=>dom.window.document.getElementById(id)!;
    try{
      const firstUi=phoneDom(uiGrant.url);
      assert.equal(firstUi.window.location.hash,'');assert.equal(element(firstUi,'exchange').hidden,false);
      assert.equal((await db.qrAccessGrant.findUniqueOrThrow({where:{id:uiGrant.grantId}})).consumedAt,null);
      element(firstUi,'exchange').click();await until(()=>!element(firstUi,'location').hidden);
      assert.equal(element(firstUi,'lot').textContent,fixture.snapshot.name);assert.equal(firstUi.window.document.querySelector('img'),null);
      assert.match(element(firstUi,'place').textContent!,/1F-A01/);assert.match(element(firstUi,'estimate').textContent!,/낮음/);
      assert.equal(firstUi.window.document.querySelectorAll('svg rect[fill="#168369"]').length,1);
      assert.equal(firstUi.window.document.cookie,'');assert.equal(firstUi.window.localStorage.length,0);assert.equal(firstUi.window.sessionStorage.length,0);
      assert.ok(!firstUi.window.document.body.textContent!.includes(new URL(uiGrant.url).hash.slice(1)));
      const revisit=phoneDom(origin+'/p');await until(()=>!element(revisit,'location').hidden);
      element(revisit,'logout').click();await until(()=>element(revisit,'status').textContent!.includes('닫았습니다'));
      assert.equal(element(revisit,'location').hidden,true);assert.equal(await db.qrPhoneSession.count({where:{grantId:uiGrant.grantId,revokedAt:{not:null}}}),1);
      const replacementUi=await issue(alice.accessToken,uiId),revokedUi=phoneDom(replacementUi.url);
      element(revokedUi,'exchange').click();await until(()=>!element(revokedUi,'location').hidden);
      await status(await api('/parked-locations/'+uiId+'/qr-tokens/'+replacementUi.grantId,alice.accessToken,'DELETE',{},'ui-revoke'),200);
      element(revokedUi,'refresh').click();await until(()=>element(revokedUi,'status').textContent!.includes('만료'));
      assert.equal(element(revokedUi,'location').hidden,true);assert.equal(revokedUi.window.document.querySelector('svg'),null);assert.equal(element(revokedUi,'place').textContent,'');
    }finally{for(const dom of doms)dom.window.close();}
    await status(await api(root,session.split('=')[1]),401); // phone cookie cannot become an account bearer
    await status(await view(session,{Origin:'https://elsewhere.invalid'}),403,'QR_ORIGIN_REJECTED');
    await status(await api('/qr/location?token='+rawToken,undefined,'GET',undefined,undefined,{Cookie:session}),400);
    // App restart retains exchanged rights with a valid issuer; current correction is reflected.
    await app.close();app=await createApp(readConfig(env),r=>logs.push(r));await app.listen(0,'127.0.0.1');base=await app.getUrl();db=app.get(DatabaseService).client;
    await status(await view(session),200);
    await status(await api(root,alice.accessToken,'PATCH',{expectedVersion:2,parkingSpaceId:'ground-s02'},'new-selection'),200);
    assert.equal((await (await view(session)).json() as {parkingSpaceLabel:string}).parkingSpaceLabel,'1F-A02');
    // Issuer access-token expiry does not shorten QR TTL; unlink revokes the underlying session.
    await db.authSession.update({where:{id:vehicle.sessionId},data:{accessExpiresAt:new Date(Date.now()-1)}});
    await status(await view(session),200);
    await status(await api('/auth/vehicle-links/'+pair.installationId,alice.accessToken,'DELETE'),204);
    await status(await view(session),410,'QR_UNAVAILABLE');await status(await exchange(grant,winner,'race'),410,'QR_UNAVAILABLE');
    const replacement=await issue(alice.accessToken,location.locationId,3),redeemed=await redeem(replacement);
    await status(await api(root+'/qr-tokens/'+replacement.grantId,bob.accessToken,'DELETE',{},'wrong-revoke'),404);
    const revoke=await api(root+'/qr-tokens/'+replacement.grantId,alice.accessToken,'DELETE',{},'revoke');await status(revoke,200);
    await status(await api(root+'/qr-tokens/'+replacement.grantId,alice.accessToken,'DELETE',{},'revoke'),200);
    await status(await view(redeemed.session),410,'QR_UNAVAILABLE');await status(await exchange(replacement,redeemed.phone),410,'QR_UNAVAILABLE');
    const old=await issue(alice.accessToken,location.locationId,3),oldPhone=await redeem(old),newest=await issue(alice.accessToken,location.locationId,3);
    await status(await view(oldPhone.session),410,'QR_UNAVAILABLE');await status(await exchange(old,oldPhone.phone),410,'QR_UNAVAILABLE');
    const exp=await redeem(newest),expired=new Date(Date.now()-1),createdAt=new Date(expired.getTime()-QR_TTL_MS);
    await db.qrAccessGrant.update({where:{id:newest.grantId},data:{createdAt,expiresAt:expired}});
    await status(await view(exp.session),410,'QR_UNAVAILABLE');await status(await exchange(newest,exp.phone),410,'QR_UNAVAILABLE');
    const logoutGrant=await issue(alice.accessToken,location.locationId,3),logoutPhone=await redeem(logoutGrant);
    await status(await api('/qr/logout',undefined,'POST',{},'phone-logout',{Origin:origin,Cookie:logoutPhone.session+'; '+logoutPhone.phone.cookie,'X-CSRF-Token':logoutPhone.phone.csrf}),204);
    await status(await view(logoutPhone.session),410,'QR_UNAVAILABLE');await status(await exchange(logoutGrant,logoutPhone.phone),409,'QR_ALREADY_EXCHANGED');
    const sessionExpiryGrant=await issue(alice.accessToken,location.locationId,3),sessionExpiry=await redeem(sessionExpiryGrant);
    await db.qrPhoneSession.update({where:{grantId:sessionExpiryGrant.grantId},data:{createdAt:new Date(Date.now()-10000),expiresAt:expired}});
    await status(await view(sessionExpiry.session),410,'QR_UNAVAILABLE');
    const epochGrant=await issue(alice.accessToken,location.locationId,3),epochPhone=await redeem(epochGrant);
    await db.parkedLocation.update({where:{id:location.locationId},data:{accessEpoch:{increment:1}}});await status(await view(epochPhone.session),410,'QR_UNAVAILABLE');
    const deleteGrant=await issue(alice.accessToken,location.locationId,3),deletePhone=await redeem(deleteGrant);
    await status(await api(root,alice.accessToken,'DELETE',{expectedVersion:3},'delete'),200);
    await status(await view(deletePhone.session),410,'QR_UNAVAILABLE');await status(await exchange(deleteGrant,deletePhone.phone),410,'QR_UNAVAILABLE');
    // Explicit issuer logout invalidates all derived access without deleting a different location.
    const second=await api('/parked-locations',alice.accessToken,'POST',{...input,clientRecordId:'logout-record'},'second');const secondId=(await second.json() as {locationId:string}).locationId;
    const unknown=await issue(alice.accessToken,secondId),unknownPhone=await redeem(unknown);
    const unknownView=await (await view(unknownPhone.session)).json() as {map:null;floorLabel:null};assert.equal(unknownView.map,null);assert.equal(unknownView.floorLabel,null);
    await status(await api('/auth/logout',alice.accessToken,'POST',{}),204);
    await status(await view(unknownPhone.session),410,'QR_UNAVAILABLE');
    await status(await api('/qr/exchanges',undefined,'POST',{token:secret()},'unknown',{Origin:origin,Cookie:phoneA.cookie,'X-CSRF-Token':phoneA.csrf}),410,'QR_UNAVAILABLE');
    const renewed=await login('-a'),expiredIssuerGrant=await issue(renewed.accessToken,secondId),expiredIssuer=await redeem(expiredIssuerGrant);
    await db.authSession.update({where:{id:renewed.sessionId},data:{refreshExpiresAt:new Date(Date.now()-1)}});await status(await view(expiredIssuer.session),410,'QR_UNAVAILABLE');
    await db.$executeRawUnsafe('INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES ($1,NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300',hash('qr-public:127.0.0.1'));
    await status(await view(expiredIssuer.session),429,'RATE_LIMITED');
    for(const value of [rawToken,session.split('=')[1]!,phoneA.csrf,phoneA.cookie,key,'private-note-never-in-phone',location.locationId,alice.accessToken])assert.ok(!JSON.stringify(logs).includes(value),value);
    const captures={grant:{...grant,url:origin+'/p#'+'A'.repeat(43)},exchange:exchangeBody,phone:projection};
    if(process.env.QR_CAPTURE_DIR)for(const [name,value] of Object.entries(captures))await writeFile(process.env.QR_CAPTURE_DIR+'/'+name+'.json',JSON.stringify(value,null,2));
  }finally{
    try{
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_qr_failure ON "QrPhoneSession"');await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_qr_failure()');
      await db.qrPhoneSession.deleteMany({where:{grant:{userId:{in:users}}}});await db.qrAccessGrant.deleteMany({where:{userId:{in:users}}});
      await db.locationMutation.deleteMany({where:{userId:{in:users}}});await db.locationChange.deleteMany({where:{location:{userId:{in:users}}}});await db.parkedLocation.deleteMany({where:{userId:{in:users}}});
      await db.parkingSpace.deleteMany({where:{lotId}});await db.lotDriveAisle.deleteMany({where:{lotId}});await db.lotPillar.deleteMany({where:{lotId}});await db.lotRamp.deleteMany({where:{lotId}});await db.lotEntrance.deleteMany({where:{lotId}});await db.lotZone.deleteMany({where:{lotId}});await db.lotFloor.deleteMany({where:{lotId}});await db.lotRevision.deleteMany({where:{lotId}});await db.parkingLot.deleteMany({where:{id:lotId}});
      await db.vehiclePairing.deleteMany({where:{installationId:{in:installations}}});await db.authSession.deleteMany({where:{userId:{in:users}}});await db.installation.deleteMany({where:{id:{in:installations}}});await db.authIdentity.deleteMany({where:{userId:{in:users}}});await db.user.deleteMany({where:{id:{in:users}}});await db.authRateBucket.deleteMany();
    }finally{await app.close();}
  }
});
