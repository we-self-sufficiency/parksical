import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import { seedSyntheticLot, SYNTHETIC_LOT_ID } from '../../src/lots/seed-store.js';

test('real PG lots: administrator permissions, immutable revisions, concurrent writes, references, seed and failures', async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  const devKey = 'synthetic-lot-development-key-00000001';
  const records: Record<string, string | number>[] = [];
  const app = await createApp(readConfig({ ...process.env, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: devKey }), r => records.push(r));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), db = app.get(DatabaseService).client;
  const users: string[] = [], ids = [SYNTHETIC_LOT_ID], prefix = randomUUID();
  const fixture = JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json', 'utf8')) as LotCreateDto;
  const call = (path: string, method = 'GET', body?: unknown, token?: string, key?: string) => fetch(base + '/api/v1' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(key ? { 'Idempotency-Key': key } : {}), 'X-Development-Key': devKey },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  async function login(suffix: string) {
    const r = await call('/auth/development/login', 'POST', { subject: prefix + suffix }); assert.equal(r.status, 200);
    const token = await r.json() as { userId: string; accessToken: string; sessionId: string }; users.push(token.userId); return token;
  }
  const expectError = async (r: Response, status: number, code?: string) => {
    assert.equal(r.status, status, await r.clone().text()); if (code) assert.equal((await r.json() as { error: { code: string } }).error.code, code);
  };
  const seedEnv = { NODE_ENV: 'test', ALLOW_SYNTHETIC_SEED: 'true' };
  try {
    const admin = await login('-admin'), user = await login('-user');
    await expectError(await call('/admin/lots'), 401);
    await expectError(await call('/admin/lots', 'POST', fixture, user.accessToken, 'denied'), 403);
    await db.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
    const secondAdmin = await login('-admin'); // same user, independent authentication session
    const body = structuredClone(fixture); body.code = 'test-' + prefix;
    const created = await Promise.all([call('/admin/lots', 'POST', body, admin.accessToken, 'create'), call('/admin/lots', 'POST', body, admin.accessToken, 'create')]);
    assert.deepEqual(created.map(r => r.status), [201, 201]);
    const first = await created[0]!.json() as { id: string; version: number; currentVersion: number; snapshot: LotCreateDto['snapshot'] };
    assert.deepEqual(first, await created[1]!.json()); ids.push(first.id);
    assert.equal(created.filter(r => r.headers.get('Idempotency-Replayed') === 'true').length, 1);
    assert.equal(await db.lotRevision.count({ where: { lotId: first.id } }), 1);
    const competing = { ...body, code: body.code + '-race' };
    const registrations = await Promise.all([call('/admin/lots', 'POST', competing, admin.accessToken, 'register-a'), call('/admin/lots', 'POST', competing, secondAdmin.accessToken, 'register-b')]);
    assert.deepEqual(registrations.map(r => r.status).sort(), [201, 409]);
    const registeredId = (await registrations.find(r => r.status === 201)!.json() as { id: string }).id; ids.push(registeredId);
    await expectError(await call('/admin/lots', 'POST', { ...body, snapshot: { ...body.snapshot, name: 'changed' } }, admin.accessToken, 'create'), 409, 'IDEMPOTENCY_CONFLICT');
    await expectError(await call('/admin/lots', 'POST', body, admin.accessToken, 'new-key'), 409, 'LOT_CODE_CONFLICT');
    await expectError(await call('/admin/lots', 'POST', body, admin.accessToken), 400, 'INVALID_IDEMPOTENCY_KEY');

    const edit = { expectedVersion: 1, snapshot: { ...body.snapshot, name: '수정된 가상 주차장', zones: body.snapshot.zones.map(z => ({ ...z, label: 'v2 ' + z.label })) } };
    const edit2 = { ...edit, snapshot: { ...edit.snapshot, name: '다른 동시 수정' } };
    const race = await Promise.all([call('/admin/lots/' + first.id, 'PUT', edit, admin.accessToken, 'edit1'), call('/admin/lots/' + first.id, 'PUT', edit2, secondAdmin.accessToken, 'edit2')]);
    assert.deepEqual(race.map(r => r.status).sort(), [200, 409]);
    assert.equal(await db.lotRevision.count({ where: { lotId: first.id } }), 2);
    assert.equal(await db.lotMutation.count({ where: { authSession: { userId: admin.userId } } }), 3, 'failed optimistic update rolls back its receipt');
    const disabled = { expectedVersion: 2, snapshot: { ...body.snapshot, active: false, fees: null, operatingHours: null, builtYear: null, floors: [], zones: [], entrances: [], ramps: [], parkingSpaces: [], pillars: [], driveAisles: [], structureStatus: 'UNKNOWN' } };
    await expectError(await call('/admin/lots/' + first.id, 'PUT', disabled, admin.accessToken, 'disable'), 200);
    const historical = await call('/admin/lots/' + first.id + '/revisions/1', 'GET', undefined, admin.accessToken);
    assert.equal(historical.headers.get('cache-control'), 'no-store');
    const old = await historical.json() as typeof first;
    assert.deepEqual(old.snapshot, body.snapshot); assert.equal(old.currentVersion, 3); assert.equal(old.version, 1);
    const current = await (await call('/admin/lots/' + first.id, 'GET', undefined, admin.accessToken)).json() as typeof first;
    assert.equal(current.snapshot.active, false); assert.equal(current.version, 3);
    const replayedCreate = await call('/admin/lots', 'POST', body, admin.accessToken, 'create');
    assert.equal(replayedCreate.status, 201); assert.equal(replayedCreate.headers.get('Idempotency-Replayed'), 'true');
    assert.deepEqual(await replayedCreate.json(), first, 'original response stays unchanged after later edits/disable');
    assert.equal(await db.lotFloor.count({ where: { lotId: first.id, version: 1 } }), 2, 'disabling/removing current geometry retains historical rows');
    assert.equal(await db.parkingSpace.count({ where: { lotId: first.id, version: 1 } }), 32);
    assert.equal(await db.lotPillar.count({ where: { lotId: first.id, version: 1 } }), 12);
    await expectError(await call('/admin/lots/' + first.id, 'DELETE', undefined, admin.accessToken), 404);
    await expectError(await call('/admin/lots/' + first.id + '/revisions/99', 'GET', undefined, admin.accessToken), 404);
    await expectError(await call('/admin/lots/' + first.id + '/revisions/0', 'GET', undefined, admin.accessToken), 400);
    await expectError(await call('/admin/lots?unexpected=x', 'GET', undefined, admin.accessToken), 400);
    await expectError(await call('/admin/lots?after=not-uuid', 'GET', undefined, admin.accessToken), 400);
    const list = await (await call('/admin/lots', 'GET', undefined, admin.accessToken)).json() as { items: { id: string; active: boolean; source: string }[] };
    assert.ok(list.items.some(x => x.id === first.id && !x.active && x.source === 'SYNTHETIC'));
    const nextPage = await (await call('/admin/lots?after=' + first.id, 'GET', undefined, admin.accessToken)).json() as typeof list;
    assert.ok(nextPage.items.every(x => x.id > first.id));
    await expectError(await call('/lots', 'GET', undefined, user.accessToken), 400, 'INVALID_REQUEST');

    // A different lot contributes unique child identifiers; neither API nor composite DB FKs may borrow them.
    const other = structuredClone(body); other.code += '-other'; other.snapshot.floors[0]!.id = 'foreign-floor';
    other.snapshot.zones[0]!.floorId = 'foreign-floor'; other.snapshot.entrances[0]!.floorId = 'foreign-floor'; other.snapshot.ramps[0]!.fromFloorId = 'foreign-floor';
    for (const p of [...other.snapshot.parkingSpaces!, ...other.snapshot.pillars!, ...other.snapshot.driveAisles!]) if (p.floorId === 'ground') p.floorId = 'foreign-floor';
    const otherResponse = await call('/admin/lots', 'POST', other, admin.accessToken, 'other'); assert.equal(otherResponse.status, 201);
    const otherId = (await otherResponse.json() as { id: string }).id; ids.push(otherId);
    const invalids: [string, (s: LotCreateDto['snapshot']) => void, number][] = [
      ['foreign-floor', s => { s.zones[0]!.floorId = 'foreign-floor'; }, 422],
      ['wrong-zone-floor', s => { s.entrances[0]!.zoneId = 'basement-a'; }, 422],
      ['same-floor-ramp', s => { s.ramps[0]!.toFloorId = 'ground'; }, 422],
      ['duplicate-id', s => { s.floors.push(s.floors[0]!); }, 422],
      ['open-polygon', s => { s.zones[0]!.polygon!.pop(); }, 422],
      ['crossed-polygon', s => { s.zones[0]!.polygon = [{ x:0,y:0 },{ x:4,y:4 },{ x:0,y:3 },{ x:4,y:0 },{ x:0,y:0 }]; }, 422],
      ['empty-complete', s => { s.floors = []; s.zones = []; s.entrances = []; s.ramps = []; }, 422],
      ['overlapping-hours', s => { s.operatingHours!.push({ day:1,openMinute:10,closeMinute:20 }); }, 422],
      ['latitude-range', s => { s.latitude = 91; }, 400],
      ['negative-fee', s => { s.fees!.baseAmount = -1; }, 400],
      ['mechanical-challenge', s => { s.parkingType = 'MECHANICAL'; Object.assign(s, { challengeAllowed: true }); }, 400],
      ['real-source', s => { Object.assign(s, { source: 'REAL' }); }, 400],
      ['nested-array', s => { Object.assign(s, { factorScores: [] }); }, 400],
      ['polygon-array', s => { Object.assign(s.zones[0]!, { polygon: [[0, 0], [1, 0], [0, 1], [0, 0]] }); }, 400],
      ['extra-field', s => { Object.assign(s, { difficulty: 5 }); }, 400],
      ['future-source', s => { s.sourceUpdatedAt = new Date(Date.now() + 3600000).toISOString(); }, 422],
      ['space-zone', s => { s.parkingSpaces![0]!.zoneId = 'basement-a'; }, 422],
      ['space-label', s => { s.parkingSpaces![1]!.label = s.parkingSpaces![0]!.label; }, 422],
      ['space-outside', s => { s.parkingSpaces![0]!.center = { x:50,y:5 }; }, 422],
      ['space-overlap', s => { s.parkingSpaces![1]!.center = s.parkingSpaces![0]!.center; }, 422],
      ['zone-overlap', s => { s.zones.push({...s.zones[0]!,id:'overlap'}); s.parkingSpaces![1]!.zoneId='overlap'; s.parkingSpaces![1]!.center=s.parkingSpaces![0]!.center; }, 422],
      ['pillar-space', s => { s.pillars![0]!.center = s.parkingSpaces![0]!.center; }, 422],
      ['pillar-overlap', s => { s.pillars![1]!.center = s.pillars![0]!.center; }, 422],
      ['pillar-outside', s => { s.pillars![0]!.center = {x:0,y:0}; }, 422],
      ['space-unknown', s => { s.parkingSpaces![0]!.center = null; }, 422],
      ['negative-size', s => { s.parkingSpaces![0]!.widthMm = -1; }, 400],
      ['space-occupancy', s => { Object.assign(s.parkingSpaces![0]!, { occupancy:'FREE' }); }, 400],
      ['approach-blocked', s => { s.pillars![0]!.center={x:s.parkingSpaces![2]!.center!.x,y:11.6};s.pillars![0]!.islandDepthMm=600; }, 422],
      ['aisle-blocked', s => { s.pillars![0]!.center={x:20,y:15}; }, 422],
      ['wrong-aisle', s => { s.parkingSpaces![0]!.approach!.aisleId='basement1-central'; }, 422],
      ['no-approach', s => { s.parkingSpaces![0]!.approach=null; }, 422],
      ['short-approach', s => { s.parkingSpaces![0]!.approach!.depthMm=1000; }, 422],
    ];
    for (const [key, mutate, status] of invalids) {
      const invalid = structuredClone(body); invalid.code += '-' + key; mutate(invalid.snapshot);
      const response=await call('/admin/lots', 'POST', invalid, admin.accessToken, key);
      if(response.status===201)ids.push((await response.clone().json() as {id:string}).id);
      await expectError(response, status);
      assert.equal(await db.parkingLot.count({ where: { code: invalid.code } }), 0);
    }
    await assert.rejects(db.lotZone.create({ data: { lotId: first.id, version: 1, id: 'wrong', floorId: 'foreign-floor' } }));
    await assert.rejects(db.lotZone.create({ data: { lotId: first.id, version: 3, id: 'wrong', floorId: 'ground' } }), 'other revision floor is not a valid reference');
    await assert.rejects(db.lotEntrance.create({ data: { lotId: first.id, version: 1, id: 'wrong', floorId: 'ground', zoneId: 'basement-a' } }));
    await assert.rejects(db.lotRamp.create({ data: { lotId: first.id, version: 1, id: 'wrong', fromFloorId: 'ground', toFloorId: 'basement1', fromZoneId: 'basement-a' } }));
    await assert.rejects(db.parkingSpace.create({ data: { lotId: first.id, version: 1, id: 'wrong', floorId: 'ground', zoneId: 'basement-a', label:'wrong', type:'GENERAL', active:true } }));
    await assert.rejects(db.parkingSpace.create({ data: { lotId: first.id, version: 1, id: 'duplicate-number', floorId: 'ground', zoneId:'ground-a', label:body.snapshot.parkingSpaces![0]!.label, type:'GENERAL', active:true } }));
    await assert.rejects(db.lotPillar.create({ data: { lotId: first.id, version: 3, id:'wrong', floorId:'ground', zoneId:'ground-a' } }));
    await assert.rejects(db.parkingLot.delete({ where: { id: first.id } }), 'historical FK prevents destructive deletion');

    const unknown=structuredClone(body);unknown.code+='-draft';unknown.snapshot.structureStatus='DRAFT';unknown.snapshot.pillars=[];
    unknown.snapshot.parkingSpaces=[{...body.snapshot.parkingSpaces![0]!,center:null,widthMm:null,lengthMm:null,headingDegrees:null}];
    const drafted=await call('/admin/lots','POST',unknown,admin.accessToken,'draft');assert.equal(drafted.status,201);
    const draft=await drafted.json() as typeof first;ids.push(draft.id);assert.equal(draft.snapshot.parkingSpaces![0]!.center,null);

    await assert.rejects(seedSyntheticLot(db, { NODE_ENV: 'production', ALLOW_SYNTHETIC_SEED: 'true' }));
    await assert.rejects(seedSyntheticLot(db, { NODE_ENV: 'test' }));
    const seeded = await Promise.all([seedSyntheticLot(db, seedEnv), seedSyntheticLot(db, seedEnv)]);
    assert.deepEqual(seeded[0], seeded[1]);
    assert.equal(await db.parkingLot.count({ where: { code: fixture.code } }), 1);
    assert.equal(await db.lotRevision.count({ where: { lotId: SYNTHETIC_LOT_ID } }), 1);
    execFileSync(process.execPath, ['dist/lots/seed.js'], { stdio: 'pipe', env: { ...process.env, ...seedEnv } });
    await expectError(await call('/admin/lots/' + SYNTHETIC_LOT_ID, 'PUT', { expectedVersion: 1, snapshot: { ...fixture.snapshot, name: '관리자가 수정' } }, admin.accessToken, 'seed-edit'), 200);
    await assert.rejects(seedSyntheticLot(db, seedEnv), /SYNTHETIC_SEED_DIVERGED/);
    assert.equal((await db.lotRevision.findUniqueOrThrow({ where: { lotId_version: { lotId: SYNTHETIC_LOT_ID, version: 2 } } })).name, '관리자가 수정');

    await db.user.update({ where: { id: admin.userId }, data: { role: 'USER' } });
    await expectError(await call('/admin/lots', 'POST', body, admin.accessToken, 'create'), 403, 'FORBIDDEN');
    assert.ok(!JSON.stringify(records).includes(admin.accessToken)); assert.ok(!JSON.stringify(records).includes(body.snapshot.address));
  } finally {
    try {
      await db.lotMutation.deleteMany({ where: { authSession: { userId: { in: users } } } });
      await db.lotRamp.deleteMany({ where: { lotId: { in: ids } } });
      await db.lotEntrance.deleteMany({ where: { lotId: { in: ids } } });
      await db.parkingSpace.deleteMany({ where: { lotId: { in: ids } } });
      await db.lotDriveAisle.deleteMany({ where: { lotId: { in: ids } } });
      await db.lotPillar.deleteMany({ where: { lotId: { in: ids } } });
      await db.lotZone.deleteMany({ where: { lotId: { in: ids } } });
      await db.lotFloor.deleteMany({ where: { lotId: { in: ids } } });
      await db.lotRevision.deleteMany({ where: { lotId: { in: ids } } });
      await db.parkingLot.deleteMany({ where: { id: { in: ids } } });
      await db.authSession.deleteMany({ where: { userId: { in: users } } });
      await db.authIdentity.deleteMany({ where: { userId: { in: users } } });
      await db.user.deleteMany({ where: { id: { in: users } } });
      await db.authRateBucket.deleteMany();
    } finally { await app.close(); }
  }
});
