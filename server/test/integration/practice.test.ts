import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';
import { writeRevision } from '../../src/lots/store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { RunResultDto } from '../../src/missions/dto.js';

test('real PG practice: sixth-run award, late records/revocation, concurrent receipts/rollback, scope, reports and persistence', async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  const key = 'synthetic-practice-development-key-000001', prefix = randomUUID(), logs: Record<string, string | number>[] = [];
  const env = { ...process.env, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: key, DEV_MISSIONS_ENABLED: 'true' };
  let app = await createApp(readConfig(env), r => logs.push(r)); await app.listen(0, '127.0.0.1'); let base = await app.getUrl();
  const db = app.get(DatabaseService).client, lotId = randomUUID(), users: string[] = [], installs: string[] = [];
  const fixture = JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json', 'utf8')) as LotCreateDto;
  const scenarios = JSON.parse(await readFile('fixtures/missions/result-scenarios.json', 'utf8')) as { scenarios: { name: string; result: RunResultDto }[] };
  type Token = { userId: string; accessToken: string; sessionId: string };
  type Vehicle = Token & { installationId: string };
  type Progress = { currentStreak: number; qualified: boolean; qualifyingRunId: string | null; recognition: null | { id: string; status: string }; rankingEligible: boolean; rewardEligible: boolean; operationalChallengeAllowed: boolean; goalVersion: string };
  const request = (path: string, token?: string, method = 'GET', body?: unknown, idem?: string) => fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Development-Key': key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function error(r: Response, status: number, code?: string) { assert.equal(r.status, status, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); if (code) assert.equal((await r.json() as { error: { code: string } }).error.code, code); }
  async function json<T>(r: Response, status = 200): Promise<T> { assert.equal(r.status, status, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); return r.json() as Promise<T>; }
  async function login(n: number) { const t = await json<Token>(await request('/auth/development/login', undefined, 'POST', { subject: prefix + '-' + n })); users.push(t.userId); return t; }
  async function pair(owner: Token) {
    const start = await json<{ installationId: string; deviceCode: string; userCode: string }>(await request('/auth/vehicle-links', undefined, 'POST', {}), 201); installs.push(start.installationId);
    await json(await request('/auth/vehicle-links/approve', owner.accessToken, 'POST', { userCode: start.userCode }));
    return { ...await json<Token>(await request('/auth/vehicle-links/exchange', undefined, 'POST', { deviceCode: start.deviceCode })), installationId: start.installationId };
  }
  try {
    await db.$transaction(async tx => { await tx.parkingLot.create({ data: { id: lotId, code: prefix, currentVersion: 1 } }); await writeRevision(tx, lotId, 1, fixture.snapshot); });
    const owner = await login(0), outsider = await login(1), vehicle = await pair(owner), second = await pair(owner);
    const origin = Date.now() - 180000, checkedAt = new Date(origin).toISOString();
    const capabilities = Object.fromEntries(['gear', 'speed', 'steeringAngle', 'brake', 'safetyWarnings', 'carProfile', 'navigation'].map(signal => [signal, { status: 'SUPPORTED', checkedAt }]));
    const session = async (v: Vehicle) => (await json<{ id: string }>(await request('/vehicle-sessions', v.accessToken, 'POST', { contractVersion: '1.0', appVersion: 'synthetic-practice', installationId: v.installationId, reportedSource: 'SYNTHETIC', capabilities }, 'session-' + randomUUID()), 201)).id;
    const vehicleSessionId = await session(vehicle), secondSessionId = await session(second);
    const catalog = await json<{ items: { missionCode: string; stage: { stageId: string } | null }[] }>(await request('/missions?lotId=' + lotId + '&structureVersion=1', owner.accessToken));
    const reverse = catalog.items.find(i => i.missionCode === 'ONE_SHOT_REVERSE')!.stage!.stageId, smooth = catalog.items.find(i => i.missionCode === 'SMOOTH_STEERING')!.stage!.stageId;
    async function create(index: number, patch: Record<string, unknown> = {}, v = vehicle) {
      return json<{ runId: string }>(await request('/runs', v.accessToken, 'POST', { contractVersion: '1.0', clientRunId: 'practice-' + randomUUID(), vehicleSessionId: v.installationId === second.installationId ? secondSessionId : vehicleSessionId, lotId, structureVersion: 1, ruleVersion: 'missions-v1', source: 'SYNTHETIC', mode: 'PRACTICE', stageIds: [reverse], startedAt: new Date(origin + index * 2000).toISOString(), ...patch }, 'create-' + randomUUID()), 201);
    }
    function report(index: number, name = 'reverse-success', count?: number) {
      const dto = structuredClone(scenarios.scenarios.find(s => s.name === name)!.result);
      dto.finishedAt = new Date(origin + index * 2000 + dto.elapsedMs).toISOString();
      if (count !== undefined) { dto.stages[0]!.metrics.gearTransitionCount = count; dto.stages[0]!.quality.find(q => q.signal === 'gear')!.validSampleCount = count + 1; }
      return dto;
    }
    const finish = async (id: string, index: number, name = 'reverse-success', count?: number) => json(await request('/runs/' + id + '/result', vehicle.accessToken, 'POST', report(index, name, count), 'result-' + randomUUID()), 201);
    const progress = async (id: string, token = owner.accessToken) => json<Progress>(await request('/practice/progress?runId=' + id, token));
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const id = (await create(i)).runId; ids.push(id);
      if (i === 5) {
        // The third success and recognition must roll back together on receipt failure.
        await db.$executeRawUnsafe(`CREATE FUNCTION test_practice_result_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='practice-rollback' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
        await db.$executeRawUnsafe('CREATE TRIGGER test_practice_result_failure BEFORE INSERT ON "MissionRunMutation" FOR EACH ROW EXECUTE FUNCTION test_practice_result_failure()');
        try { await error(await request('/runs/' + id + '/result', vehicle.accessToken, 'POST', report(i), 'practice-rollback'), 500); assert.equal(await db.missionRunResult.count({ where: { runId: id } }), 0); assert.equal(await db.practiceRecognition.count({ where: { userId: owner.userId } }), 0); }
        finally { await db.$executeRawUnsafe('DROP TRIGGER test_practice_result_failure ON "MissionRunMutation"'); await db.$executeRawUnsafe('DROP FUNCTION test_practice_result_failure()'); }
        const dto = report(i, 'reverse-success', 2);
        const race = await Promise.all(['finish-a', 'finish-b'].map(k => request('/runs/' + id + '/result', vehicle.accessToken, 'POST', dto, k)));
        assert.deepEqual(race.map(r => r.status), [201, 201]); assert.deepEqual(await race[0]!.json(), await race[1]!.json());
      } else await finish(id, i, i === 2 ? 'reverse-failed' : 'reverse-success', i === 4 ? 4 : undefined);
      const state = await progress(id); assert.equal(state.qualified, i === 5); if (i === 5) assert.equal(state.qualifyingRunId, id);
    }
    const qualified = await progress(ids[5]!), awardId = qualified.recognition!.id;
    assert.equal(qualified.currentStreak, 3); assert.equal(qualified.rankingEligible, false); assert.equal(qualified.rewardEligible, false); assert.equal(qualified.operationalChallengeAllowed, false); assert.equal(qualified.goalVersion, 'practice-v1');
    assert.equal(await db.practiceRecognition.count({ where: { userId: owner.userId } }), 1);
    const detail = await json<{ summary: { gearTransitionCount: number; abruptSteeringCount: null }; comparison: { previousRunId: string; delta: { gearTransitionCount: number }; fasterTimeRewarded: boolean }; rawTrajectoryAvailable: boolean }>(await request('/practice/runs/' + ids[5], owner.accessToken));
    assert.equal(detail.summary.gearTransitionCount, 2); assert.equal(detail.summary.abruptSteeringCount, null); assert.equal(detail.comparison.previousRunId, ids[4]); assert.equal(detail.comparison.delta.gearTransitionCount, -2); assert.equal(detail.comparison.fasterTimeRewarded, false); assert.equal(detail.rawTrajectoryAvailable, false);
    const legacy = await json<{ summary: { gearTransitionCount: null } }>(await request('/practice/runs/' + ids[0], vehicle.accessToken)); assert.equal(legacy.summary.gearTransitionCount, null);
    await error(await request('/practice/runs/' + ids[0]), 401);
    await error(await request('/practice/runs/' + ids[0], outsider.accessToken), 404);
    await error(await request('/practice/progress?runId=' + ids[0], second.accessToken), 404);
    assert.equal((await json<{ items: unknown[] }>(await request('/practice/awards', second.accessToken))).items.length, 0);
    await db.user.update({ where: { id: outsider.userId }, data: { role: 'ADMIN' } }); await error(await request('/practice/runs/' + ids[0], outsider.accessToken), 404);
    const challenge = (await create(10, { mode: 'CHALLENGE' })).runId; await finish(challenge, 10);
    await error(await request('/practice/runs/' + challenge, owner.accessToken), 404); assert.equal(await db.practiceRecord.count({ where: { runId: challenge } }), 0);
    const page = await json<{ items: { runId: string }[]; nextCursor: string }>(await request('/practice/runs?limit=2', vehicle.accessToken)); assert.equal(page.items.length, 2); assert.ok(page.nextCursor); assert.ok(page.items.every(r => r.runId !== challenge));
    await json(await request('/practice/runs?limit=2&cursor=' + page.nextCursor, vehicle.accessToken)); await error(await request('/practice/runs?limit=3&cursor=' + page.nextCursor, vehicle.accessToken), 400); await error(await request('/practice/runs?limit=2&cursor=' + page.nextCursor, outsider.accessToken), 400);
    await error(await request('/practice/progress?runId=' + ids[0] + '&rawSignals=x', owner.accessToken), 400); await error(await request('/practice/runs/' + ids[0] + '?x=1', owner.accessToken), 400);
    // Late occurrence inside the successful window changes the live projection, never the immutable result receipt.
    const late = (await create(4.5)).runId; const provisional = await progress(ids[5]!); assert.equal(provisional.qualified, false); assert.equal(provisional.recognition!.status, 'REVOKED'); assert.equal(provisional.recognition!.id, awardId);
    await finish(late, 4.5, 'reverse-failed'); assert.equal((await progress(ids[5]!)).qualified, false);
    for (const i of [11, 12, 13]) { const id = (await create(i)).runId; ids.push(id); await finish(id, i); }
    assert.equal((await progress(ids.at(-1)!)).recognition!.id, awardId); assert.equal((await progress(ids.at(-1)!)).qualified, true);
    const target = ids.at(-2)!, invalidatePath = '/practice/runs/' + target + '/invalidation', invalidation = { expectedVersion: 1, reason: 'CORRECTION' };
    await error(await request(invalidatePath, owner.accessToken, 'POST', invalidation), 400, 'INVALID_IDEMPOTENCY_KEY'); await error(await request(invalidatePath, outsider.accessToken, 'POST', invalidation, 'outsider'), 404);
    for (const patch of [{ expectedVersion: 2 }, { reason: 'restore' }, { rawTrajectory: [] }, { userId: owner.userId }]) await error(await request(invalidatePath, owner.accessToken, 'POST', { ...invalidation, ...patch }, 'invalid'), 400);
    await db.$executeRawUnsafe(`CREATE FUNCTION test_practice_mutation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='invalidate-rollback' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_practice_mutation_failure BEFORE INSERT ON "PracticeMutation" FOR EACH ROW EXECUTE FUNCTION test_practice_mutation_failure()');
    try { await error(await request(invalidatePath, owner.accessToken, 'POST', invalidation, 'invalidate-rollback'), 500); assert.equal((await db.practiceRecord.findUniqueOrThrow({ where: { runId: target } })).invalidatedAt, null); assert.equal((await progress(target)).qualified, true); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER test_practice_mutation_failure ON "PracticeMutation"'); await db.$executeRawUnsafe('DROP FUNCTION test_practice_mutation_failure()'); }
    const invalidations = await Promise.all(['invalidate-a', 'invalidate-b'].map(k => request(invalidatePath, owner.accessToken, 'POST', invalidation, k)));
    assert.deepEqual(invalidations.map(r => r.status), [201, 201]); const receipt = await invalidations[0]!.json(); assert.deepEqual(receipt, await invalidations[1]!.json()); assert.equal(invalidations.filter(r => r.headers.get('Idempotency-Replayed') === 'true').length, 1);
    const revoked = await progress(target); assert.equal(revoked.qualified, false); assert.equal(revoked.currentStreak, 1); assert.equal(revoked.recognition!.id, awardId); assert.equal(revoked.recognition!.status, 'REVOKED');
    assert.equal((await db.missionRunResult.findUniqueOrThrow({ where: { runId: target } })).outcome, 'COMPLETED');
    await error(await request(invalidatePath, owner.accessToken, 'POST', { ...invalidation, reason: 'USER_REQUEST' }, 'invalidate-a'), 409, 'IDEMPOTENCY_CONFLICT');
    await error(await request(invalidatePath, owner.accessToken, 'POST', { ...invalidation, reason: 'USER_REQUEST' }, 'different'), 409, 'PRACTICE_ALREADY_INVALIDATED');
    await assert.rejects(db.practiceRecord.update({ where: { runId: ids[0]! }, data: { goalVersion: 'practice-v2' } })); await assert.rejects(db.practiceRecord.update({ where: { runId: target }, data: { invalidatedAt: null, invalidationReason: null } }));
    const impossible = (await create(14)).runId, impossibleResult = report(14, 'reverse-success', 2); impossibleResult.stages[0]!.quality.find(q => q.signal === 'gear')!.validSampleCount = 1;
    await error(await request('/runs/' + impossible + '/result', vehicle.accessToken, 'POST', impossibleResult, 'impossible-gear-count'), 422, 'INVALID_GEAR_TRANSITION_COUNT');
    const pending = (await create(15)).runId; await error(await request('/practice/runs/' + pending + '/invalidation', vehicle.accessToken, 'POST', invalidation, 'pending'), 422, 'PRACTICE_RESULT_REQUIRED');
    const smoothRun = (await create(16, { stageIds: [smooth] })).runId; await finish(smoothRun, 16, 'smooth-two-stars', 3);
    const smoothReport = await json<{ summary: { abruptSteeringCount: number }; goalSucceeded: boolean }>(await request('/practice/runs/' + smoothRun, owner.accessToken)); assert.equal(smoothReport.summary.abruptSteeringCount, 1); assert.equal(smoothReport.goalSucceeded, false); assert.equal((await progress(smoothRun)).recognition, null);
    await db.$transaction(async tx => { await writeRevision(tx, lotId, 2, { ...fixture.snapshot, name: 'Synthetic practice revision 2' }); await tx.parkingLot.update({ where: { id: lotId }, data: { currentVersion: 2 } }); });
    const revised = (await create(17, { structureVersion: 2 })).runId; await finish(revised, 17); assert.equal((await progress(revised)).recognition, null); assert.equal((await progress(revised)).currentStreak, 1);
    // Active sessions and grants are still checked after reconnect; materialized awards survive pool/process rebuild.
    await app.close(); app = await createApp(readConfig(env), r => logs.push(r)); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    const replay = await request(invalidatePath, owner.accessToken, 'POST', invalidation, 'invalidate-a'); assert.equal(replay.status, 201); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await replay.json(), receipt);
    const awards = await json<{ items: Progress[]; nextCursor: null }>(await request('/practice/awards', owner.accessToken)); assert.equal(awards.items.length, 1); assert.equal(awards.items[0]!.recognition!.id, awardId); assert.equal(awards.items[0]!.recognition!.status, 'REVOKED');
    // An older S-12 process can append results without refreshing the new projection.
    const oldStyle: string[] = [];
    for (const i of [20, 21, 22]) {
      const id = (await create(i, {}, second)).runId; oldStyle.push(id);
      const dto = report(i);
      await db.missionRunResult.create({ data: { runId: id, clientResultId: 'old-style-' + i, requestHash: 'a'.repeat(64), source: 'SYNTHETIC', outcome: 'COMPLETED', stars: 3, finishedAt: new Date(dto.finishedAt), elapsedMs: dto.elapsedMs, report: JSON.parse(JSON.stringify(dto)), assessment: {}, receipt: {} } });
    }
    assert.equal(await db.practiceRecognition.count({ where: { userId: owner.userId, installationId: second.installationId } }), 0);
    const rebuilt = await Promise.all([progress(oldStyle[2]!, second.accessToken), progress(oldStyle[2]!, owner.accessToken)]);
    assert.equal(rebuilt[0]!.qualified, true); assert.equal(rebuilt[0]!.recognition!.id, rebuilt[1]!.recognition!.id); assert.notEqual(rebuilt[0]!.recognition!.id, awardId);
    const awardPage = await json<{ items: Progress[]; nextCursor: string }>(await request('/practice/awards?limit=1', owner.accessToken)); assert.ok(awardPage.nextCursor);
    const awardRest = await json<{ items: Progress[]; nextCursor: null }>(await request('/practice/awards?limit=1&cursor=' + awardPage.nextCursor, owner.accessToken)); assert.equal(awardRest.items.length, 1); assert.equal(awardRest.nextCursor, null); assert.notEqual(awardRest.items[0]!.recognition!.id, awardPage.items[0]!.recognition!.id);
    await error(await request('/practice/awards?limit=2&cursor=' + awardPage.nextCursor, owner.accessToken), 400);
    await error(await request('/practice/awards?limit=1&cursor=' + awardPage.nextCursor, outsider.accessToken), 400);
    const child = spawn(process.execPath, ['dist/main.js'], { env: { ...env, PORT: '39073' }, stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      let ready = false;
      for (let n = 0; n < 50; n++) { try { ready = (await fetch('http://127.0.0.1:39073/api/v1/health/ready')).status === 200; if (ready) break; } catch { /* Child starting. */ } await pause(100); }
      assert.equal(ready, true);
      const persisted = await fetch('http://127.0.0.1:39073/api/v1/practice/progress?runId=' + target, { headers: { Authorization: 'Bearer ' + owner.accessToken } });
      const state = await json<Progress>(persisted); assert.equal(state.recognition!.id, awardId); assert.equal(state.recognition!.status, 'REVOKED');
    } finally { if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; } }
    const rateKey = createHash('sha256').update('practice-read:' + owner.userId).digest('hex');
    await db.$executeRaw`INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES (${rateKey},NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300`;
    await error(await request('/practice/runs', owner.accessToken), 429, 'RATE_LIMITED'); await db.authRateBucket.deleteMany({ where: { key: rateKey } });
    const disabled = await createApp(readConfig({ ...env, DEV_MISSIONS_ENABLED: 'false' }), () => {}); await disabled.listen(0, '127.0.0.1');
    try { await error(await fetch(await disabled.getUrl() + '/api/v1/practice/runs', { headers: { Authorization: 'Bearer ' + owner.accessToken } }), 403, 'MISSIONS_POLICY_DISABLED'); } finally { await disabled.close(); }
    assert.equal((await request('/auth/vehicle-links/' + vehicle.installationId, owner.accessToken, 'DELETE')).status, 204); await error(await request('/practice/runs/' + ids[0], vehicle.accessToken), 401);
    for (const secret of [key, owner.accessToken, vehicle.accessToken, ...users, lotId, 'gearTransitionCount', 'CORRECTION']) assert.ok(!JSON.stringify(logs).includes(secret));
    if (process.env.PRACTICE_CAPTURE_DIR) {
      const examples = { 'practice-report.json': detail, 'practice-page.json': page, 'practice-progress.json': qualified, 'practice-awards.json': awards, 'practice-invalidate.json': invalidation, 'practice-invalidated.json': receipt };
      for (const [name, value] of Object.entries(examples)) await writeFile(process.env.PRACTICE_CAPTURE_DIR + '/' + name, JSON.stringify(value, null, 2) + '\n');
    }
  } finally {
    const clean = app.get(DatabaseService).client;
    try {
      await clean.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_practice_result_failure ON "MissionRunMutation"'); await clean.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_practice_result_failure()');
      await clean.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_practice_mutation_failure ON "PracticeMutation"'); await clean.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_practice_mutation_failure()');
      await clean.missionRunMutation.deleteMany({ where: { userId: { in: users } } }); await clean.missionRunResult.deleteMany({ where: { run: { userId: { in: users } } } }); await clean.missionRun.deleteMany({ where: { userId: { in: users } } });
      await clean.vehicleSession.deleteMany({ where: { userId: { in: users } } });
      await clean.parkingSpace.deleteMany({ where: { lotId } }); await clean.lotDriveAisle.deleteMany({ where: { lotId } }); await clean.lotPillar.deleteMany({ where: { lotId } }); await clean.lotRamp.deleteMany({ where: { lotId } }); await clean.lotEntrance.deleteMany({ where: { lotId } }); await clean.lotZone.deleteMany({ where: { lotId } }); await clean.lotFloor.deleteMany({ where: { lotId } }); await clean.lotRevision.deleteMany({ where: { lotId } }); await clean.parkingLot.deleteMany({ where: { id: lotId } });
      await clean.vehiclePairing.deleteMany({ where: { installationId: { in: installs } } }); await clean.authSession.deleteMany({ where: { userId: { in: users } } }); await clean.installation.deleteMany({ where: { id: { in: installs } } }); await clean.authIdentity.deleteMany({ where: { userId: { in: users } } }); await clean.user.deleteMany({ where: { id: { in: users } } }); await clean.authRateBucket.deleteMany();
    } finally { await app.close(); }
  }
});
