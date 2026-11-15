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
import { asJson, writeRevision } from '../../src/lots/store.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { RunResultDto } from '../../src/missions/dto.js';
import { missionCatalog, validateRunResult, type StagePlan } from '../../src/missions/rules.js';
import { RankingService } from '../../src/rankings/ranking.service.js';
import { monthOf } from '../../src/rankings/rules.js';

test('real PG rankings: KST/recognition, consent/privacy, final cutoff, tombstones, concurrency/rollback and process persistence', async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  const key = 'synthetic-ranking-development-key-00001', prefix = randomUUID(), users: string[] = [], installs: string[] = [], lotId = randomUUID(), logs: Record<string, string | number>[] = [];
  const env = { ...process.env, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: key, DEV_MISSIONS_ENABLED: 'true', DEV_RANKINGS_ENABLED: 'true' };
  let app = await createApp(readConfig(env), r => logs.push(r)); await app.listen(0, '127.0.0.1'); let base = await app.getUrl();
  const db = app.get(DatabaseService).client;
  type Token = { userId: string; accessToken: string; sessionId: string };
  type Vehicle = Token & { installationId: string; vehicleSessionId: string };
  type RecordView = { runId: string; month: string; cohortKey: string; recognition: string; recordVersion: number; deletedAt: string | null; rankingEligible: false; rewardEligible: false };
  type Consent = { version: number; enabled: boolean; nickname: string | null; agreedAt: string | null; changedAt: string | null };
  type Board = { items: { entryId: string; nickname: string; score: number; rank: number }[]; status: string; nextCursor: string | null; snapshotId: string | null; rankingEligible: false; rewardEligible: false; operationalAllowed: false };
  const fixture = JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json', 'utf8')) as LotCreateDto;
  const catalog = missionCatalog(fixture.snapshot), reverse = catalog.items.find(i => i.missionCode === 'ONE_SHOT_REVERSE')!.stage!, smooth = catalog.items.find(i => i.missionCode === 'SMOOTH_STEERING')!.stage!;
  const scenarios = JSON.parse(await readFile('fixtures/missions/result-scenarios.json', 'utf8')) as { scenarios: { name: string; result: RunResultDto }[] };
  const request = (path: string, token?: string, method = 'GET', body?: unknown, idem?: string) => fetch(base + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Development-Key': key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function json<T>(r: Response, status = 200): Promise<T> { assert.equal(r.status, status, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); return r.json() as Promise<T>; }
  async function error(r: Response, status: number, code?: string) { assert.equal(r.status, status, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); if (code) assert.equal((await r.json() as { error: { code: string } }).error.code, code); }
  async function login(n: number) { const t = await json<Token>(await request('/auth/development/login', undefined, 'POST', { subject: prefix + '-' + n })); users.push(t.userId); return t; }
  async function pair(owner: Token): Promise<Vehicle> {
    const start = await json<{ installationId: string; deviceCode: string; userCode: string }>(await request('/auth/vehicle-links', undefined, 'POST', {}), 201); installs.push(start.installationId);
    await json(await request('/auth/vehicle-links/approve', owner.accessToken, 'POST', { userCode: start.userCode }));
    const v = await json<Token>(await request('/auth/vehicle-links/exchange', undefined, 'POST', { deviceCode: start.deviceCode }));
    const checkedAt = new Date().toISOString(), capabilities = Object.fromEntries(['gear', 'speed', 'steeringAngle', 'brake', 'safetyWarnings', 'carProfile', 'navigation'].map(s => [s, { status: 'SUPPORTED', checkedAt }]));
    const session = await json<{ id: string }>(await request('/vehicle-sessions', v.accessToken, 'POST', { contractVersion: '1.0', appVersion: 'synthetic-rankings', installationId: start.installationId, reportedSource: 'SYNTHETIC', capabilities }, 'session-' + randomUUID()), 201);
    return { ...v, installationId: start.installationId, vehicleSessionId: session.id };
  }
  function report(name: string, startedAt: Date) { const dto = structuredClone(scenarios.scenarios.find(s => s.name === name)!.result); dto.finishedAt = new Date(startedAt.getTime() + dto.elapsedMs).toISOString(); return dto; }
  // Explicit historical SYNTHETIC fixtures exercise closed months; they bypass only the HTTP upload-age limit.
  async function historical(v: Vehicle, at: string, name: string | null = 'reverse-success', stage: StagePlan = reverse, received?: string, unchecked = false) {
    const startedAt = new Date(at), receivedAt = received ? new Date(received) : new Date(startedAt.getTime() + 5000);
    const row = await db.missionRun.create({ data: { userId: v.userId, installationId: v.installationId, authSessionId: v.sessionId, vehicleSessionId: v.vehicleSessionId, clientRunId: 'historical-' + randomUUID(), creationHash: '0'.repeat(64), creationResponse: {}, source: 'SYNTHETIC', mode: 'CHALLENGE', lotId, structureVersion: 1, ruleVersion: 'missions-v1', rules: asJson(catalog.rules), stages: asJson([stage]), capabilities: {}, startedAt, receivedAt } });
    if (name) { const dto = report(name, startedAt); await db.missionRunResult.create({ data: { runId: row.id, clientResultId: randomUUID(), requestHash: '1'.repeat(64), source: 'SYNTHETIC', outcome: dto.outcome, stars: dto.stars, elapsedMs: dto.elapsedMs, finishedAt: new Date(dto.finishedAt), receivedAt, report: asJson(dto), assessment: asJson(unchecked ? {} : validateRunResult([stage], catalog.rules, startedAt, dto, new Date(startedAt.getTime() + 5000))), receipt: {} } }); }
    return row.id;
  }
  try {
    await db.$transaction(async tx => { await tx.parkingLot.create({ data: { id: lotId, code: prefix, currentVersion: 1 } }); await writeRevision(tx, lotId, 1, fixture.snapshot); });
    const a = await login(0), b = await login(1), c = await login(2), outsider = await login(3);
    const av = await pair(a), bv = await pair(b), cv = await pair(c), otherInstall = await pair(a);
    const first = await historical(av, '2026-10-31T14:59:59.500Z'), later = await historical(otherInstall, '2026-10-31T14:59:59.600Z'), tied = await historical(bv, '2026-10-31T14:59:59.500Z'), low = await historical(cv, '2026-10-30T00:00:00.000Z', 'reverse-failed');
    const beforeCutoff = await historical(av, '2026-10-31T14:59:59.700Z', 'reverse-success', reverse, '2026-11-03T14:59:59.999Z');
    const atCutoff = await historical(av, '2026-10-31T14:59:59.800Z', 'reverse-success', reverse, '2026-11-03T15:00:00.000Z');
    const pending = await historical(av, '2026-10-29T00:00:00.000Z', null), unchecked = await historical(cv, '2026-10-30T01:00:00.000Z', 'reverse-success', reverse, undefined, true);
    const freshMonth = await historical(av, '2026-10-31T15:00:00.000Z', null);
    const different = await historical(av, '2026-10-30T01:00:00.000Z', 'smooth-two-stars', smooth);
    const rec = await json<RecordView>(await request('/ranking-records/' + first, a.accessToken)); assert.equal(rec.month, '2026-10'); assert.equal(rec.recognition, 'SYNTHETIC_CONSISTENT'); assert.equal(rec.rankingEligible, false);
    assert.equal((await json<RecordView>(await request('/ranking-records/' + beforeCutoff, a.accessToken))).recognition, 'SYNTHETIC_CONSISTENT');
    assert.equal((await json<RecordView>(await request('/ranking-records/' + atCutoff, a.accessToken))).recognition, 'AFTER_CUTOFF');
    assert.equal((await json<RecordView>(await request('/ranking-records/' + freshMonth, a.accessToken))).month, '2026-11');
    assert.notEqual((await json<RecordView>(await request('/ranking-records/' + different, a.accessToken))).cohortKey, rec.cohortKey);
    assert.equal((await json<RecordView>(await request('/ranking-records/' + unchecked, c.accessToken))).recognition, 'UNRECOGNIZED');
    const q = '?month=2026-10&cohortKey=' + rec.cohortKey, path = '/rankings/' + lotId, board = async (extra = '') => json<Board>(await request(path + q + extra, a.accessToken));
    const off = await json<Consent>(await request('/me/ranking-consent', a.accessToken)); assert.equal(off.enabled, false); assert.equal(off.version, 0);
    // Legacy boolean does not manufacture a versioned public consent.
    await db.user.update({ where: { id: a.userId }, data: { rankingPublic: true } }); assert.equal((await json<{ rankingPublic: boolean }>(await request('/me', a.accessToken))).rankingPublic, false);
    assert.equal((await board()).items.length, 0); assert.equal((await json<{ items: unknown[] }>(await request(path + '/cohorts?month=2026-10', a.accessToken))).items.length, 0);
    const consentDto = (version = 0, enabled = true) => ({ expectedVersion: version, policyVersion: 'rankings-public-v1', enabled, agreedAt: enabled ? new Date().toISOString() : null });
    const bDto = consentDto(), bConsent = await json<Consent>(await request('/me/ranking-consent', b.accessToken, 'PUT', bDto, 'consent-b'));
    await json(await request('/me/ranking-consent', c.accessToken, 'PUT', consentDto(), 'consent-c'));
    const publicBefore = await board(); assert.deepEqual(publicBefore.items.map(r => r.score), [3, 0]); assert.deepEqual(publicBefore.items.map(r => r.rank), [1, 2]);
    const selfBefore = await json<{ bestRunId: string; score: number; rank: number; publiclyListed: boolean }>(await request(path + '/me' + q, av.accessToken)); assert.equal(selfBefore.bestRunId, first); assert.equal(selfBefore.rank, 1); assert.equal(selfBefore.publiclyListed, false);
    const aDto = consentDto(), consentRaces = await Promise.all(['consent-a1', 'consent-a2'].map(k => request('/me/ranking-consent', a.accessToken, 'PUT', aDto, k)));
    assert.deepEqual(consentRaces.map(r => r.status).sort(), [200, 409]); const aConsent = await json<Consent>(await request('/me/ranking-consent', a.accessToken)); assert.equal(aConsent.version, 1); assert.match(aConsent.nickname!, /^P-[a-f0-9]{12}$/);
    assert.ok(Math.abs(Date.parse(aConsent.changedAt!) - Date.now()) < 5000, 'DB epoch time must be correct without a timezone offset');
    const publicOn = await board(); assert.equal(publicOn.items.length, 3); assert.deepEqual(publicOn.items.map(r => r.rank), [1, 1, 2]);
    const cohortPage = await json<{ items: unknown[] }>(await request(path + '/cohorts?month=2026-10', a.accessToken)); assert.equal(cohortPage.items.length, 2, 'both explicitly public cohorts are discoverable');
    const publicText = JSON.stringify(publicOn); for (const secret of [a.userId, b.userId, c.userId, ...installs, first, later, tied, low, av.sessionId, av.vehicleSessionId, 'startedAt', 'elapsedMs', 'bestRunId']) assert.ok(!publicText.includes(secret), secret);
    await error(await request(path + q + '&cursor=' + Buffer.from('null').toString('base64url'), a.accessToken), 400, 'INVALID_RANKING_CURSOR');
    const page = await board('&limit=1'); assert.ok(page.nextCursor); const rest = await board('&limit=1&cursor=' + page.nextCursor); assert.equal(rest.items.length, 1); assert.notEqual(rest.items[0]!.entryId, page.items[0]!.entryId);
    await error(await request(path + q + '&limit=2&cursor=' + page.nextCursor, a.accessToken), 400);
    await error(await request(path + q + '&limit=1&cursor=' + page.nextCursor, b.accessToken), 400);
    const withdrawn = await json<Consent>(await request('/me/ranking-consent', b.accessToken, 'PUT', consentDto(1, false), 'withdraw-b')); assert.equal(withdrawn.enabled, false); assert.equal(withdrawn.nickname, null);
    await error(await request(path + q + '&limit=1&cursor=' + page.nextCursor, a.accessToken), 409, 'RANKING_VIEW_CHANGED');
    assert.ok(!(await board()).items.some(r => r.nickname === bConsent.nickname));
    const bReplay = await request('/me/ranking-consent', b.accessToken, 'PUT', bDto, 'consent-b'); assert.equal(bReplay.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await json(bReplay), bConsent); assert.equal((await json<Consent>(await request('/me/ranking-consent', b.accessToken))).enabled, false);
    await json(await request('/me/ranking-consent', b.accessToken, 'PUT', consentDto(2), 'renew-b'));
    const ranking = app.get(RankingService), frozen = await Promise.all([ranking.finalizeSyntheticMonth(lotId, '2026-10', rec.cohortKey), ranking.finalizeSyntheticMonth(lotId, '2026-10', rec.cohortKey)]);
    assert.equal(frozen[0]!.snapshotId, frozen[1]!.snapshotId); assert.equal(frozen[0]!.inputHash, frozen[1]!.inputHash); assert.equal(frozen[0]!.syntheticCandidates.length, 3); assert.deepEqual(frozen[0]!.operationalCandidates, []); assert.equal(frozen[0]!.rewardEligible, false);
    const finalized = await board(); assert.equal(finalized.status, 'FINALIZED'); assert.equal(finalized.snapshotId, frozen[0]!.snapshotId);
    const late = await historical(cv, '2026-10-30T02:00:00.000Z', 'reverse-success', reverse, new Date().toISOString()); assert.equal((await json<RecordView>(await request('/ranking-records/' + late, c.accessToken))).recognition, 'AFTER_CUTOFF'); assert.equal((await board()).items.length, 3);
    const invalidate = { expectedVersion: 1, reason: 'CORRECTION' }, invalidatePath = '/ranking-records/' + first + '/invalidation';
    await db.$executeRawUnsafe(`CREATE FUNCTION test_ranking_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='ranking-rollback' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_ranking_failure BEFORE INSERT ON "RankingMutation" FOR EACH ROW EXECUTE FUNCTION test_ranking_failure()');
    await error(await request(invalidatePath, a.accessToken, 'POST', invalidate, 'ranking-rollback'), 500); assert.equal((await db.rankingRecord.findUniqueOrThrow({ where: { runId: first } })).version, 1); assert.equal((await board()).items.length, 3);
    await db.$executeRawUnsafe('DROP TRIGGER test_ranking_failure ON "RankingMutation"'); await db.$executeRawUnsafe('DROP FUNCTION test_ranking_failure()');
    const invalidRaces = await Promise.all(['invalidate-a', 'invalidate-b'].map(k => request(invalidatePath, a.accessToken, 'POST', invalidate, k))); assert.deepEqual(invalidRaces.map(r => r.status), [201, 201]);
    const invalidReceipt = await invalidRaces[0]!.json(); assert.deepEqual(await invalidRaces[1]!.json(), invalidReceipt);
    assert.equal((await board()).items.length, 2, 'finalized best record is removed with no fallback/promotion to another personal attempt');
    assert.equal((await json<{ bestRunId: string | null }>(await request(path + '/me' + q, a.accessToken))).bestRunId, null);
    await error(await request('/ranking-records/' + pending + '/invalidation', a.accessToken, 'POST', invalidate, 'pending-invalidate'), 422, 'RANKING_RESULT_REQUIRED');
    const deletion = { expectedVersion: 2, reason: 'USER_REQUEST' }, deletionPath = '/ranking-records/' + first + '/deletion';
    const deleted = await json(await request(deletionPath, av.accessToken, 'POST', deletion, 'delete-first'), 201); assert.equal((await db.rankingRecord.findUniqueOrThrow({ where: { runId: first } })).version, 3);
    assert.equal(await db.missionRunResult.count({ where: { runId: first } }), 1, 'ranking removal preserves original mission receipt');
    await assert.rejects(db.rankingRecord.update({ where: { runId: first }, data: { version: 4, deletedAt: null } }));
    await assert.rejects(db.rankingMonthSnapshot.update({ where: { id: frozen[0]!.snapshotId }, data: { candidates: [] } }));
    await json(await request('/me/ranking-consent', b.accessToken, 'PUT', consentDto(3, false), 'final-withdraw')); assert.equal((await board()).items.length, 1, 'withdrawal applies after finalization');
    const after = await ranking.finalizeSyntheticMonth(lotId, '2026-10', rec.cohortKey); assert.equal(after.inputHash, frozen[0]!.inputHash); assert.equal(after.syntheticCandidates.length, 2, 'private internal synthetic input keeps withdrawn consent separate, but excludes invalidated/deleted'); assert.deepEqual(after.operationalCandidates, []);
    await error(await request('/ranking-records/' + first, outsider.accessToken), 404); await db.user.update({ where: { id: outsider.userId }, data: { role: 'ADMIN' } }); await error(await request(deletionPath, outsider.accessToken, 'POST', deletion, 'admin-other'), 404);
    await error(await request(path + q), 401); await error(await request(path + q + '&source=REAL', a.accessToken), 400);
    await error(await request('/me/ranking-consent', a.accessToken, 'PUT', { ...consentDto(1), nickname: 'private@example.invalid' }, 'extra-nickname'), 400);
    await error(await request('/me/ranking-consent', a.accessToken, 'PUT', { ...consentDto(1), agreedAt: '2026-01-01T00:00:00Z' }, 'stale-consent'), 422);
    await error(await request('/me/ranking-consent', a.accessToken, 'PUT', consentDto(0), 'stale-version'), 409);
    await error(await request('/me/ranking-consent', a.accessToken, 'PUT', consentDto(1)), 400, 'INVALID_IDEMPOTENCY_KEY');
    // Genuine current HTTP writes, no projection hook required, and a practice record remains excluded.
    const startedAt = new Date(Date.now() - 1000), createDto = { contractVersion: '1.0', clientRunId: randomUUID(), vehicleSessionId: av.vehicleSessionId, lotId, structureVersion: 1, ruleVersion: 'missions-v1', source: 'SYNTHETIC', mode: 'CHALLENGE', stageIds: [reverse.stageId], startedAt: startedAt.toISOString() };
    const current = await json<{ runId: string }>(await request('/runs', av.accessToken, 'POST', createDto, 'current-create'), 201);
    assert.equal((await json<RecordView>(await request('/ranking-records/' + current.runId, a.accessToken))).recognition, 'INCOMPLETE');
    await json(await request('/runs/' + current.runId + '/result', av.accessToken, 'POST', report('reverse-success', startedAt), 'current-result'), 201);
    const currentRec = await json<RecordView>(await request('/ranking-records/' + current.runId, a.accessToken)); assert.equal(currentRec.recognition, 'SYNTHETIC_CONSISTENT');
    const currentQ = '?month=' + monthOf(startedAt) + '&cohortKey=' + currentRec.cohortKey;
    const secondCurrent = await json<{ runId: string }>(await request('/runs', av.accessToken, 'POST', { ...createDto, clientRunId: randomUUID(), startedAt: new Date(startedAt.getTime() + 100).toISOString() }, 'second-current'), 201);
    await json(await request('/runs/' + secondCurrent.runId + '/result', av.accessToken, 'POST', report('reverse-success', new Date(startedAt.getTime() + 100)), 'second-current-result'), 201);
    assert.equal((await json<{ bestRunId: string }>(await request(path + '/me' + currentQ, a.accessToken))).bestRunId, current.runId);
    await json(await request('/ranking-records/' + current.runId + '/invalidation', a.accessToken, 'POST', invalidate, 'invalidate-current'), 201);
    assert.equal((await json<{ bestRunId: string }>(await request(path + '/me' + currentQ, a.accessToken))).bestRunId, secondCurrent.runId, 'provisional invalidation selects next valid personal attempt');
    await db.rankingMutation.createMany({ data: Array.from({ length: 4000 }, (_, i) => ({ userId: a.userId, key: 'old-receipt-' + i, requestHash: '0'.repeat(64), response: {} })) });
    await json(await request('/ranking-records/' + secondCurrent.runId + '/deletion', a.accessToken, 'POST', { expectedVersion: 1, reason: 'USER_REQUEST' }, 'delete-current'), 201);
    await json(await request('/me/ranking-consent', a.accessToken, 'PUT', consentDto(1, false), 'withdraw-after-many-receipts'));
    assert.equal((await json<Consent>(await request('/me/ranking-consent', a.accessToken))).enabled, false, 'receipt quota must not prevent withdrawal or participation deletion');
    // Historical synthetic consent fixture: preserve every version without exhausting HTTP rate buckets.
    await db.$transaction(async tx => {
      for (let version = 1; version <= 1000; version++) {
        const data = { version, policyVersion: 'rankings-public-v1', enabled: true, agreedAt: new Date(), changedAt: new Date() };
        if (version === 1) await tx.rankingConsent.create({ data: { userId: outsider.userId, nickname: 'P-123456789abc', ...data } });
        else await tx.rankingConsent.update({ where: { userId: outsider.userId }, data });
        await tx.rankingConsentChange.create({ data: { userId: outsider.userId, ...data } });
      }
    }, { timeout: 30000 });
    const exhaustedWithdrawal = await json<Consent>(await request('/me/ranking-consent', outsider.accessToken, 'PUT', consentDto(1000, false), 'withdraw-after-1000-versions'));
    assert.equal(exhaustedWithdrawal.enabled, false); assert.equal(exhaustedWithdrawal.version, 1001);
    const noOpWithdrawal = await json<Consent>(await request('/me/ranking-consent', outsider.accessToken, 'PUT', consentDto(1001, false), 'already-disabled'));
    assert.equal(noOpWithdrawal.version, 1001);
    await assert.rejects(ranking.finalizeSyntheticMonth(lotId, monthOf(startedAt), currentRec.cohortKey));
    const practice = await json<{ runId: string }>(await request('/runs', av.accessToken, 'POST', { ...createDto, clientRunId: randomUUID(), mode: 'PRACTICE' }, 'current-practice'), 201); await error(await request('/ranking-records/' + practice.runId, a.accessToken), 404);
    await json(await request('/ranking-records/' + low + '/deletion', c.accessToken, 'POST', { expectedVersion: 1, reason: 'USER_REQUEST' }, 'delete-final-low'), 201);
    const hiddenFinal = await board(); assert.equal(hiddenFinal.items.length, 0, 'direct deletion also masks a finalized public entry'); assert.equal(hiddenFinal.snapshotId, null, 'public empty board must not disclose a private finalized snapshot');
    const beforeRestart = await board();
    await app.close(); app = await createApp(readConfig(env), r => logs.push(r)); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    assert.deepEqual(await board(), beforeRestart); const deletedReplay = await request(deletionPath, a.accessToken, 'POST', deletion, 'delete-first'); assert.equal(deletedReplay.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await json(deletedReplay, 201), deleted);
    const child = spawn(process.execPath, ['dist/main.js'], { env: { ...env, PORT: '39085' }, stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      let ready = false; for (let n = 0; n < 50; n++) { try { ready = (await fetch('http://127.0.0.1:39085/api/v1/health/ready')).status === 200; if (ready) break; } catch { /* Child starting. */ } await pause(100); } assert.equal(ready, true);
      const persisted = await json<Board>(await fetch('http://127.0.0.1:39085/api/v1' + path + q, { headers: { Authorization: 'Bearer ' + a.accessToken } })); assert.deepEqual(persisted, beforeRestart);
    } finally { if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; } }
    const rateKey = createHash('sha256').update('ranking-read:' + a.userId).digest('hex'); await db.$executeRaw`INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES (${rateKey},NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300`;
    await error(await request(path + q, a.accessToken), 429, 'RATE_LIMITED'); await db.authRateBucket.deleteMany({ where: { key: rateKey } });
    const disabled = await createApp(readConfig({ ...env, DEV_RANKINGS_ENABLED: 'false' }), () => {}); await disabled.listen(0, '127.0.0.1'); try { await error(await fetch(await disabled.getUrl() + '/api/v1' + path + q, { headers: { Authorization: 'Bearer ' + a.accessToken } }), 403, 'RANKINGS_POLICY_DISABLED'); } finally { await disabled.close(); }
    assert.equal((await request('/auth/vehicle-links/' + av.installationId, a.accessToken, 'DELETE')).status, 204); await error(await request('/ranking-records/' + first, av.accessToken), 401);
    for (const secret of [key, a.accessToken, av.accessToken, ...users, lotId, first, 'CORRECTION', 'rankings-public-v1']) assert.ok(!JSON.stringify(logs).includes(secret));
    if (process.env.RANKINGS_CAPTURE_DIR) {
      const examples = { 'ranking-consent-off.json': off, 'ranking-consent-write.json': aDto, 'ranking-consent-on.json': aConsent, 'ranking-consent-withdraw.json': { expectedVersion: 1, policyVersion: 'rankings-public-v1', enabled: false, agreedAt: null }, 'ranking-cohorts.json': cohortPage, 'ranking-record.json': rec, 'ranking-board.json': publicOn, 'ranking-finalized.json': finalized, 'ranking-me.json': selfBefore, 'ranking-invalidate.json': invalidate, 'ranking-invalidated.json': invalidReceipt, 'ranking-delete.json': deletion, 'ranking-deleted.json': deleted };
      for (const [name, value] of Object.entries(examples)) await writeFile(process.env.RANKINGS_CAPTURE_DIR + '/' + name, JSON.stringify(value, null, 2) + '\n');
    }
  } finally {
    const clean = app.get(DatabaseService).client;
    try {
      await clean.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_ranking_failure ON "RankingMutation"'); await clean.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_ranking_failure()');
      await clean.rankingMonthSnapshot.deleteMany({ where: { lotId } }); await clean.missionRunMutation.deleteMany({ where: { userId: { in: users } } }); await clean.missionRunResult.deleteMany({ where: { run: { userId: { in: users } } } }); await clean.missionRun.deleteMany({ where: { userId: { in: users } } }); await clean.vehicleSession.deleteMany({ where: { userId: { in: users } } });
      await clean.parkingSpace.deleteMany({ where: { lotId } }); await clean.lotDriveAisle.deleteMany({ where: { lotId } }); await clean.lotPillar.deleteMany({ where: { lotId } }); await clean.lotRamp.deleteMany({ where: { lotId } }); await clean.lotEntrance.deleteMany({ where: { lotId } }); await clean.lotZone.deleteMany({ where: { lotId } }); await clean.lotFloor.deleteMany({ where: { lotId } }); await clean.lotRevision.deleteMany({ where: { lotId } }); await clean.parkingLot.deleteMany({ where: { id: lotId } });
      await clean.vehiclePairing.deleteMany({ where: { installationId: { in: installs } } }); await clean.authSession.deleteMany({ where: { userId: { in: users } } }); await clean.installation.deleteMany({ where: { id: { in: installs } } }); await clean.authIdentity.deleteMany({ where: { userId: { in: users } } }); await clean.user.deleteMany({ where: { id: { in: users } } }); await clean.authRateBucket.deleteMany();
    } finally { await app.close(); }
  }
});
