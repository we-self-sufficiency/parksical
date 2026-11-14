import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Request } from 'express';
import { readConfig } from '../../src/config.js';
import { validGrant } from '../../src/qr/qr.service.js';
import { QR_TTL_MS,checkCsrf,cookieNames,csrf,hash,sameOrigin,secret,validSecret } from '../../src/qr/security.js';
test('QR config is explicit development only with an exact HTTPS or loopback origin',()=>{
  const env={DATABASE_URL:'postgresql://test@127.0.0.1/qr_test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'x'.repeat(40),DEV_LOCATIONS_ENABLED:'true'};
  assert.equal(readConfig(env).devQrEnabled,false);
  assert.equal(readConfig({...env,DEV_QR_ENABLED:'true',QR_PUBLIC_ORIGIN:'https://qr.example.invalid'}).devQrEnabled,true);
  for(const origin of ['https://qr.example.invalid/','https://user:pass@qr.example.invalid','https://qr.example.invalid/p','https://qr.example.invalid?x=1','http://192.168.0.2','file:///p','null'])assert.throws(()=>readConfig({...env,QR_PUBLIC_ORIGIN:origin,DEV_QR_ENABLED:'true'}));
  assert.throws(()=>readConfig({...env,DEV_QR_ENABLED:'true'}));
  for(const patch of [{DEV_QR_ENABLED:'true',DEV_LOCATIONS_ENABLED:'false'},{DEV_QR_ENABLED:'yes'},{REAL_QR_ENABLED:'true'},{NODE_ENV:'production',DEV_QR_ENABLED:'true'}])assert.throws(()=>readConfig({...env,QR_PUBLIC_ORIGIN:'http://127.0.0.1:39061',...patch}));
});
test('QR expiry is exclusive at 24h and revocation/epoch/deletion always wins',()=>{
  const created=new Date('2026-11-15T00:00:00Z'),expiresAt=new Date(created.getTime()+QR_TTL_MS),grant={expiresAt,revokedAt:null,accessEpoch:1},location={deletedAt:null,accessEpoch:1};
  assert.equal(QR_TTL_MS,86400000);
  assert.equal(validGrant(grant,location,new Date(expiresAt.getTime()-1)),true);
  assert.equal(validGrant(grant,location,expiresAt),false);
  assert.equal(validGrant({...grant,revokedAt:created},location,created),false);
  assert.equal(validGrant(grant,{...location,accessEpoch:2},created),false);
  assert.equal(validGrant(grant,{...location,deletedAt:created},created),false);
});
test('QR credentials are bounded and CSRF requires exact origin, same-origin fetch and cookie proof',()=>{
  const seed=secret();assert.equal(validSecret(seed),true);assert.equal(hash(seed).length,64);assert.ok(!hash(seed).includes(seed));
  const origin='https://qr.example.invalid',names=cookieNames(origin);
  assert.ok(names.session.startsWith('__Host-'));
  const request=(headers:Record<string,string>)=>({headers:{cookie:names.challenge+'='+seed},get:(key:string)=>headers[key]}) as unknown as Request;
  const good={Origin:origin,'Sec-Fetch-Site':'same-origin','X-CSRF-Token':csrf(seed)};
  assert.equal(checkCsrf(request(good),origin),seed);
  for(const patch of [{Origin:origin+'.attacker.invalid'},{Origin:'null'},{Origin:''},{'Sec-Fetch-Site':'same-site'},{'Sec-Fetch-Site':'cross-site'},{'X-CSRF-Token':'f'.repeat(64)}])assert.throws(()=>checkCsrf(request({...good,...patch}),origin));
  assert.doesNotThrow(()=>sameOrigin(request({}),origin,false));assert.throws(()=>sameOrigin(request({}),origin,true));
});
