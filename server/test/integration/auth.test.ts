import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';

const devKey = 'synthetic-development-key-not-production-000001';
interface Tokens { sessionId: string; userId: string; accessToken: string; refreshToken: string; }
interface Pair { installationId: string; installationSecret: string; deviceCode: string; userCode: string; }

test('real DB auth: ownership, rotation/replay, pairing races, account switch, unlink, expiry and roles', async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  const app = await createApp(readConfig({ ...process.env, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: devKey }), record => records.push(record));
  const records: Record<string, string | number>[] = [];
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), client = app.get(DatabaseService).client;
  const users = new Set<string>(), installations = new Set<string>(), privateValues: string[] = [devKey];
  const prefix = 'test_' + randomUUID();
  async function call(path: string, method = 'GET', body?: object, token?: string, extra: Record<string, string> = {}) {
    return fetch(base + '/api/v1' + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  }
  async function login(subject: string) {
    const res = await call('/auth/development/login', 'POST', { subject }, undefined, { 'X-Development-Key': devKey });
    assert.equal(res.status, 200); assert.equal(res.headers.get('cache-control'), 'no-store');
    const tokens = await res.json() as Tokens; users.add(tokens.userId); privateValues.push(tokens.accessToken, tokens.refreshToken); return tokens;
  }
  async function pair() {
    const res = await call('/auth/vehicle-links', 'POST', {}); assert.equal(res.status, 201);
    const row = await res.json() as Pair; installations.add(row.installationId); privateValues.push(row.installationSecret, row.deviceCode, row.userCode); return row;
  }
  const refresh = (token: string) => call('/auth/refresh', 'POST', { refreshToken: token });
  try {
    const alice = await login(prefix + '_alice'), bob = await login(prefix + '_bob');
    assert.equal((await call('/me')).status, 401);
    assert.equal((await call('/me', 'GET', undefined, alice.accessToken)).status, 200);
    assert.equal((await call('/auth/development/login', 'POST', { subject: prefix + '_alice', userId: bob.userId, role: 'ADMIN' }, undefined, { 'X-Development-Key': devKey })).status, 400);
    assert.equal((await call('/auth/sessions/' + alice.sessionId, 'DELETE', undefined, bob.accessToken)).status, 404);
    const bobs = await (await call('/auth/sessions', 'GET', undefined, bob.accessToken)).json() as { id: string }[];
    assert.ok(!bobs.some(row => row.id === alice.sessionId));

    const rotating = await login(prefix + '_rotation');
    const updated = await refresh(rotating.refreshToken); assert.equal(updated.status, 200);
    const rotated = await updated.json() as Tokens; privateValues.push(rotated.accessToken, rotated.refreshToken);
    assert.equal((await call('/me', 'GET', undefined, rotating.accessToken)).status, 401);
    assert.equal((await call('/me', 'GET', undefined, rotated.accessToken)).status, 200);
    assert.equal((await refresh(rotating.refreshToken)).status, 401);
    assert.equal((await call('/me', 'GET', undefined, rotated.accessToken)).status, 401, 'replay revocation commits');

    const concurrent = await login(prefix + '_concurrent');
    const attempts = await Promise.all([refresh(concurrent.refreshToken), refresh(concurrent.refreshToken)]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 401]);
    const won = await attempts.find(r => r.status === 200)!.json() as Tokens;
    assert.equal((await call('/me', 'GET', undefined, won.accessToken)).status, 401);

    const car = await pair();
    assert.equal((await call('/auth/vehicle-links', 'POST', { installationId: car.installationId })).status, 400);
    assert.equal((await call('/auth/vehicle-links', 'POST', { installationId: car.installationId, installationSecret: 'x'.repeat(43) })).status, 401);
    assert.equal((await call('/auth/vehicle-links/exchange', 'POST', { deviceCode: car.deviceCode })).status, 409);
    const approvals = await Promise.all([call('/auth/vehicle-links/approve', 'POST', { userCode: car.userCode }, alice.accessToken), call('/auth/vehicle-links/approve', 'POST', { userCode: car.userCode }, bob.accessToken)]);
    assert.deepEqual(approvals.map(r => r.status).sort(), [200, 409]);
    const owner = approvals[0]!.status === 200 ? alice : bob, other = owner === alice ? bob : alice;
    const exchanges = await Promise.all([call('/auth/vehicle-links/exchange', 'POST', { deviceCode: car.deviceCode }), call('/auth/vehicle-links/exchange', 'POST', { deviceCode: car.deviceCode })]);
    assert.deepEqual(exchanges.map(r => r.status).sort(), [200, 409]);
    const vehicle = await exchanges.find(r => r.status === 200)!.json() as Tokens;
    privateValues.push(vehicle.accessToken, vehicle.refreshToken);
    assert.equal(vehicle.userId, owner.userId);
    assert.equal((await call('/me', 'GET', undefined, vehicle.accessToken)).status, 200);
    assert.equal((await call('/auth/vehicle-links/approve', 'POST', { userCode: car.userCode }, vehicle.accessToken)).status, 403);
    assert.equal((await call('/auth/vehicle-links/' + car.installationId, 'DELETE', undefined, other.accessToken)).status, 404);

    const renewed = await call('/auth/vehicle-links', 'POST', { installationId: car.installationId, installationSecret: car.installationSecret });
    assert.equal(renewed.status, 201); const newPair = await renewed.json() as Pair;
    assert.equal((await call('/auth/vehicle-links/approve', 'POST', { userCode: newPair.userCode }, other.accessToken)).status, 200);
    const switched = await call('/auth/vehicle-links/exchange', 'POST', { deviceCode: newPair.deviceCode });
    assert.equal(switched.status, 200); const replacement = await switched.json() as Tokens;
    assert.equal(replacement.userId, other.userId);
    assert.equal((await call('/me', 'GET', undefined, vehicle.accessToken)).status, 401);
    assert.equal((await refresh(vehicle.refreshToken)).status, 401);
    assert.equal((await call('/auth/vehicle-links/' + car.installationId, 'DELETE', undefined, owner.accessToken)).status, 404);
    assert.equal((await call('/auth/vehicle-links/' + car.installationId, 'DELETE', undefined, other.accessToken)).status, 204);
    assert.equal((await call('/me', 'GET', undefined, replacement.accessToken)).status, 401);
    assert.equal((await refresh(replacement.refreshToken)).status, 401);

    const expiredPair = await pair();
    await client.vehiclePairing.updateMany({ where: { installationId: expiredPair.installationId }, data: { expiresAt: new Date(0) } });
    assert.equal((await call('/auth/vehicle-links/approve', 'POST', { userCode: expiredPair.userCode }, alice.accessToken)).status, 409);
    assert.equal((await call('/auth/vehicle-links/exchange', 'POST', { deviceCode: expiredPair.deviceCode })).status, 409);

    const expiry = await login(prefix + '_expiry');
    await client.authSession.update({ where: { id: expiry.sessionId }, data: { accessExpiresAt: new Date(0) } });
    assert.equal((await call('/me', 'GET', undefined, expiry.accessToken)).status, 401);
    await client.authSession.update({ where: { id: expiry.sessionId }, data: { refreshExpiresAt: new Date(0) } });
    assert.equal((await refresh(expiry.refreshToken)).status, 401);

    const target = await login(prefix + '_target');
    assert.equal((await call('/auth/admin/sessions/' + target.sessionId, 'DELETE', undefined, alice.accessToken)).status, 403);
    await client.user.update({ where: { id: alice.userId }, data: { role: 'ADMIN' } });
    assert.equal((await call('/auth/admin/sessions/' + target.sessionId, 'DELETE', undefined, alice.accessToken)).status, 204);
    assert.equal((await call('/me', 'GET', undefined, target.accessToken)).status, 401);
    assert.equal((await call('/auth/logout', 'POST', undefined, bob.accessToken)).status, 204);
    assert.equal((await refresh(bob.refreshToken)).status, 401);

    const prod = await createApp(readConfig({ ...process.env, NODE_ENV: 'production', DEV_AUTH_ENABLED: 'false' }), () => {});
    await prod.listen(0, '127.0.0.1');
    try {
      const host = await prod.getUrl();
      assert.equal((await fetch(host + '/api/v1/me', { headers: { Authorization: 'Bearer ' + alice.accessToken } })).status, 401);
      assert.equal((await fetch(host + '/api/v1/auth/development/login', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Development-Key': devKey }, body: JSON.stringify({ subject: prefix }) })).status, 403);
    } finally { await prod.close(); }

    const stored = JSON.stringify(await client.authSession.findMany({ where: { userId: { in: [...users] } }, include: { refreshes: true } })) + JSON.stringify(await client.vehiclePairing.findMany({ where: { installationId: { in: [...installations] } } })) + JSON.stringify(await client.installation.findMany({ where: { id: { in: [...installations] } } }));
    for (const value of privateValues) assert.ok(!stored.includes(value), 'secret must be hashed in DB');
    for (const value of privateValues) assert.ok(!JSON.stringify(records).includes(value), 'secret must not be logged');

    await client.authRateBucket.deleteMany();
    for (let i = 0; i < 20; i++) { const row = await pair(); installations.add(row.installationId); }
    const limited = await call('/auth/vehicle-links', 'POST', {});
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '300');
  } finally {
    try {
    await client.vehiclePairing.deleteMany({ where: { installationId: { in: [...installations] } } });
    await client.authSession.deleteMany({ where: { userId: { in: [...users] } } });
    await client.installation.deleteMany({ where: { id: { in: [...installations] } } });
    await client.authIdentity.deleteMany({ where: { userId: { in: [...users] } } });
    await client.user.deleteMany({ where: { id: { in: [...users] } } });
    await client.authRateBucket.deleteMany();
    } finally { await app.close(); }
  }
});
