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
import type { LotCreateDto } from '../../src/lots/dto.js';
import { writeRevision } from '../../src/lots/store.js';
import type { ReservationPolicyWriteDto } from '../../src/reservations/dto.js';
import { localDay } from '../../src/reservations/rules.js';

test('real PG reservations: last-slot races across pools, immutable quotes, safety, expiration, sandbox payment/refund and rollback', async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  const key = 'synthetic-reservation-development-key-000001', prefix = randomUUID(), lotId = randomUUID(), users: string[] = [], installs: string[] = [], logs: Record<string, string | number>[] = [];
  const env = { ...process.env, NODE_ENV: 'test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: key, DEV_RESERVATIONS_ENABLED: 'true' };
  const app = await createApp(readConfig(env), r => logs.push(r)); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  const second = await createApp(readConfig(env), r => logs.push(r)); await second.listen(0, '127.0.0.1'); const base2 = await second.getUrl();
  const db = app.get(DatabaseService).client, fixture = JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json', 'utf8')) as LotCreateDto;
  const policy = JSON.parse(await readFile('fixtures/reservations/synthetic-policy.json', 'utf8')) as ReservationPolicyWriteDto;
  type Token = { userId: string; accessToken: string };
  type Quote = { quoteId: string; policyVersion: number; expiresAt: string; details: { amountKrw: number; generalAmountKrw: number; multiplierBps: number; safetyRulesVersion: string }; capacityReserved: boolean };
  type Reservation = { id: string; state: string; version: number; paymentStatus: string; safetyRulesVersion: string; safetyAgreedAt: string; pricing: { amountKrw: number }; operationalAllowed: boolean; realPaymentVerified: boolean };
  const request = (path: string, token?: string, method = 'GET', body?: unknown, idem?: string, origin = base) => fetch(origin + '/api/v1' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Development-Key': key, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(idem ? { 'Idempotency-Key': idem } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function json<T>(r: Response, status = 200): Promise<T> { assert.equal(r.status, status, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); return r.json() as Promise<T>; }
  async function error(r: Response, status: number, code?: string) { assert.equal(r.status, status, await r.clone().text()); assert.equal(r.headers.get('cache-control'), 'no-store'); if (code) assert.equal((await r.json() as { error: { code: string } }).error.code, code); }
  async function login(n: number) { const t = await json<Token>(await request('/auth/development/login', undefined, 'POST', { subject: prefix + '-' + n })); users.push(t.userId); return t; }
  try {
    await db.$transaction(async tx => { await tx.parkingLot.create({ data: { id: lotId, code: prefix, currentVersion: 1 } }); await writeRevision(tx, lotId, 1, fixture.snapshot); });
    const admin = await login(0), alice = await login(1), bob = await login(2), outsider = await login(3);
    await db.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
    const policyPath = '/admin/lots/' + lotId + '/reservation-policy'; let version = 0;
    async function configure(patch: Partial<typeof policy.snapshot> = {}) { policy.snapshot = { ...policy.snapshot, ...patch }; const result = await json<{ version: number }>(await request(policyPath, admin.accessToken, 'PUT', { expectedVersion: version, snapshot: policy.snapshot }, 'policy-' + randomUUID())); version = result.version; return result; }
    await error(await request('/lots/' + lotId + '/reservation-policy', alice.accessToken), 404, 'RESERVATION_POLICY_NOT_FOUND');
    await error(await request(policyPath, alice.accessToken, 'PUT', policy, 'unauthorized'), 403);
    const policyWritten = await configure();
    const policyResponse = await json<Record<string, unknown>>(await request('/lots/' + lotId + '/reservation-policy', alice.accessToken)); assert.equal(policyResponse.operationalAllowed, false);
    const date = localDay(new Date(Date.now() + 86400000)).date, startsAt = new Date(date + 'T01:00:00.000Z');
    const input = (hour: number, mode = 'PRACTICE', durationMinutes = 30) => ({ lotId, mode, startsAt: new Date(startsAt.getTime() + hour * 3600000).toISOString(), durationMinutes, lengthMm: 4800, widthMm: 1850 });
    async function quote(user: Token, hour: number, mode = 'PRACTICE', minutes = 30) { return json<Quote>(await request('/reservation-quotes', user.accessToken, 'POST', input(hour, mode, minutes), 'quote-' + randomUUID()), 201); }
    const databaseNow = Number((await db.$queryRaw<{ epochMs: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "epochMs"`)[0]!.epochMs);
    assert.ok(Math.abs(databaseNow - Date.now()) < 5000, 'DB epoch is UTC and does not shift by the session timezone');
    const agreement = (q: Quote) => ({ quoteId: q.quoteId, safetyRulesVersion: q.details.safetyRulesVersion, safetyAgreedAt: new Date().toISOString() });
    async function hold(user: Token, q: Quote) { return json<Reservation>(await request('/reservations', user.accessToken, 'POST', agreement(q), 'hold-' + randomUUID()), 201); }
    async function event(user: Token, id: string, kind: string, idem = randomUUID()) { return json<{ reservation: Reservation; evidence: { providerEventId: string; source: string; realPaymentVerified: boolean; amountKrw: number } }>(await request('/reservations/' + id + '/sandbox-events', user.accessToken, 'POST', { kind }, idem), 201); }
    const slotsPath = '/lots/' + lotId + '/reservation-slots?date=' + date + '&mode=PRACTICE&lengthMm=4800&widthMm=1850';
    const slots = await json<{ items: { startsAt: string; remainingCapacity: number }[] }>(await request(slotsPath, alice.accessToken)); assert.ok(slots.items.some(s => s.startsAt === startsAt.toISOString() && s.remainingCapacity === 1));
    await error(await request(slotsPath + '&rawSignals=x', alice.accessToken), 400); await error(await request('/reservations'), 401);
    await error(await request('/reservation-quotes', alice.accessToken, 'POST', { ...input(0), durationMinutes: 29 }, 'short-period'), 400);
    for (const patch of [{ durationMinutes: 45 }, { startsAt: new Date(startsAt.getTime() + 1).toISOString() }, { lengthMm: 5001 }]) await error(await request('/reservation-quotes', alice.accessToken, 'POST', { ...input(0), ...patch }, 'bad-period'), 422);
    for (const patch of [{ amountKrw: 1 }, { userId: bob.userId }, { durationMinutes: '30' }, { parked: true }, { source: 'REAL' }]) await error(await request('/reservation-quotes', alice.accessToken, 'POST', { ...input(0), ...patch }, 'tampered'), 400);
    const a = await quote(alice, 0), b = await quote(bob, 0, 'CHALLENGE'); assert.equal(a.details.amountKrw, 1250); assert.equal(b.details.amountKrw, 1750); assert.equal(a.capacityReserved, false);
    const quoteRetry = await request('/reservation-quotes', alice.accessToken, 'POST', input(1), 'quote-retry'), quoteReceipt = await json<Quote>(quoteRetry, 201);
    const retry = await request('/reservation-quotes', alice.accessToken, 'POST', input(1), 'quote-retry'); assert.equal(retry.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await json(retry, 201), quoteReceipt);
    await error(await request('/reservation-quotes', alice.accessToken, 'POST', input(2), 'quote-retry'), 409, 'IDEMPOTENCY_CONFLICT');
    const args = [agreement(a), agreement(b)], race = await Promise.all([request('/reservations', alice.accessToken, 'POST', args[0], 'race-alice'), request('/reservations', bob.accessToken, 'POST', args[1], 'race-bob', base2)]);
    assert.deepEqual(race.map(r => r.status).sort(), [201, 409], JSON.stringify(await Promise.all(race.map(r => r.clone().json())))); const winIndex = race.findIndex(r => r.status === 201), winner = winIndex === 0 ? alice : bob, loser = winIndex === 0 ? bob : alice;
    const reserved = await json<Reservation>(race[winIndex]!, 201); assert.equal(await db.reservationClaim.count({ where: { lotId, startsAt } }), 1);
    assert.equal(reserved.state, 'HELD'); assert.equal(reserved.paymentStatus, 'NOT_STARTED'); assert.equal(reserved.operationalAllowed, false); assert.equal(reserved.realPaymentVerified, false);
    await error(await request('/reservations/' + reserved.id, loser.accessToken), 404); await error(await request('/reservations/' + reserved.id, admin.accessToken), 404);
    await error(await request('/reservations', outsider.accessToken, 'POST', { ...args[winIndex] }, 'steal-quote'), 404);
    const duplicate = await request('/reservations', winner.accessToken, 'POST', args[winIndex], 'new-key-same-quote'); assert.equal(duplicate.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await json(duplicate, 201), reserved);
    const overlap = await quote(winner, 0); await error(await request('/reservations', winner.accessToken, 'POST', agreement(overlap), 'overlap'), 409, 'RESERVATION_USER_OVERLAP');
    const paymentRace = await Promise.all(['sandbox-a', 'sandbox-b'].map(k => request('/reservations/' + reserved.id + '/sandbox-events', winner.accessToken, 'POST', { kind: 'PAYMENT_SUCCEEDED' }, k)));
    const paid = await json<{ reservation: Reservation; evidence: { providerEventId: string; source: string; realPaymentVerified: boolean } }>(paymentRace[0]!, 201); assert.deepEqual(paid, await json(paymentRace[1]!, 201)); assert.equal(paid.reservation.state, 'SANDBOX_CONFIRMED'); assert.equal(paid.evidence.source, 'SANDBOX'); assert.equal(paid.evidence.realPaymentVerified, false);
    const path = '/reservations/' + reserved.id + '/cancel', cancel = { expectedVersion: 2, reason: 'USER_REQUEST' };
    await error(await request(path, winner.accessToken, 'POST', { ...cancel, expectedVersion: 1 }, 'old-version'), 409, 'RESERVATION_VERSION_CONFLICT');
    const cancelled = await json<Reservation>(await request(path, winner.accessToken, 'POST', cancel, 'cancel-paid'), 201); assert.equal(cancelled.state, 'REFUND_PENDING'); assert.equal(await db.reservationClaim.count({ where: { reservationId: reserved.id } }), 0);
    const refund = await event(winner, reserved.id, 'REFUND_SUCCEEDED'); assert.equal(refund.reservation.state, 'REFUNDED'); assert.equal(refund.reservation.paymentStatus, 'SANDBOX_REFUNDED');
    const cancelReplay = await request(path, winner.accessToken, 'POST', cancel, 'cancel-again'); assert.equal(cancelReplay.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await json(cancelReplay, 201), cancelled);
    const lateReplay = await event(winner, reserved.id, 'PAYMENT_SUCCEEDED'); assert.deepEqual(lateReplay, paid); assert.equal((await json<Reservation>(await request('/reservations/' + reserved.id, winner.accessToken))).state, 'REFUNDED');
    const replacement = await hold(loser, await quote(loser, 0)); assert.equal(replacement.state, 'HELD');
    const failed = await event(loser, replacement.id, 'PAYMENT_FAILED'); assert.equal(failed.reservation.state, 'PAYMENT_FAILED'); assert.equal(await db.reservationClaim.count({ where: { reservationId: replacement.id } }), 0);
    // Multi-slot holds do not partially acquire capacity or commit when receipt persistence fails.
    const blocker = await hold(bob, await quote(bob, 3)), multi = await quote(alice, 2, 'PRACTICE', 120);
    await error(await request('/reservations', alice.accessToken, 'POST', agreement(multi), 'multi-full'), 409, 'RESERVATION_SLOT_FULL'); assert.equal(await db.reservation.count({ where: { quoteId: multi.quoteId } }), 0);
    const rollbackQuote = await quote(alice, 5, 'PRACTICE', 60), rollbackInput = agreement(rollbackQuote);
    await db.$executeRawUnsafe(`CREATE FUNCTION test_reservation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key IN ('rollback-hold','rollback-cancel','rollback-event') THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER test_reservation_failure BEFORE INSERT ON "ReservationMutation" FOR EACH ROW EXECUTE FUNCTION test_reservation_failure()');
    await error(await request('/reservations', alice.accessToken, 'POST', rollbackInput, 'rollback-hold'), 500); assert.equal(await db.reservation.count({ where: { quoteId: rollbackQuote.quoteId } }), 0); assert.equal(await db.reservationClaim.count({ where: { lotId, startsAt: new Date(input(5).startsAt) } }), 0);
    const twoSlots = await hold(alice, rollbackQuote); assert.equal(await db.reservationClaim.count({ where: { reservationId: twoSlots.id } }), 2);
    await error(await request('/reservations/' + twoSlots.id + '/cancel', alice.accessToken, 'POST', { expectedVersion: 1, reason: 'USER_REQUEST' }, 'rollback-cancel'), 500); assert.equal((await db.reservation.findUniqueOrThrow({ where: { id: twoSlots.id } })).state, 'HELD'); assert.equal(await db.reservationClaim.count({ where: { reservationId: twoSlots.id } }), 2);
    await error(await request('/reservations/' + twoSlots.id + '/sandbox-events', alice.accessToken, 'POST', { kind: 'PAYMENT_SUCCEEDED' }, 'rollback-event'), 500); assert.equal(await db.reservationAction.count({ where: { reservationId: twoSlots.id } }), 0);
    await db.$executeRawUnsafe('DROP TRIGGER test_reservation_failure ON "ReservationMutation"'); await db.$executeRawUnsafe('DROP FUNCTION test_reservation_failure()');
    const unpaidCancel = await json<Reservation>(await request('/reservations/' + twoSlots.id + '/cancel', alice.accessToken, 'POST', { expectedVersion: 1, reason: 'USER_REQUEST' }, 'cancel-unpaid'), 201); assert.equal(unpaidCancel.state, 'CANCELLED');
    await assert.rejects(db.reservationQuote.update({ where: { id: rollbackQuote.quoteId }, data: { amountKrw: 1 } })); await assert.rejects(db.reservation.update({ where: { id: twoSlots.id }, data: { state: 'HELD', version: 3 } }));
    await error(await request('/reservations/' + blocker.id + '/sandbox-events', bob.accessToken, 'POST', { kind: 'REFUND_SUCCEEDED' }, 'refund-before-payment'), 409);
    for (const patch of [{ amountKrw: 1 }, { source: 'REAL' }, { providerEventId: randomUUID() }]) await error(await request('/reservations/' + blocker.id + '/sandbox-events', bob.accessToken, 'POST', { kind: 'PAYMENT_SUCCEEDED', ...patch }, 'forged-payment'), 400);
    const racing = await hold(alice, await quote(alice, 12));
    const competing = await Promise.all([request('/reservations/' + racing.id + '/cancel', alice.accessToken, 'POST', { expectedVersion: 1, reason: 'USER_REQUEST' }, 'cancel-payment-race'), request('/reservations/' + racing.id + '/sandbox-events', alice.accessToken, 'POST', { kind: 'PAYMENT_SUCCEEDED' }, 'payment-cancel-race')]);
    assert.equal(competing[1]!.status, 201); assert.ok([201, 409].includes(competing[0]!.status));
    let raceState = await json<Reservation>(await request('/reservations/' + racing.id, alice.accessToken));
    if (raceState.state === 'SANDBOX_CONFIRMED') raceState = await json<Reservation>(await request('/reservations/' + racing.id + '/cancel', alice.accessToken, 'POST', { expectedVersion: raceState.version, reason: 'USER_REQUEST' }, 'cancel-after-race'), 201);
    assert.equal(raceState.state, 'REFUND_PENDING'); assert.equal(await db.reservationClaim.count({ where: { reservationId: racing.id } }), 0); await event(alice, racing.id, 'REFUND_SUCCEEDED');
    await configure({ capacity: 2 });
    const pairA = await hold(alice, await quote(alice, 14)), pairB = await hold(bob, await quote(bob, 14));
    await error(await request(policyPath, admin.accessToken, 'PUT', { expectedVersion: version, snapshot: { ...policy.snapshot, capacity: 1 } }, 'unsafe-capacity-reduction'), 409, 'RESERVATION_CAPACITY_BELOW_EXISTING');
    assert.equal((await db.reservationPolicy.findFirstOrThrow({ where: { lotId }, orderBy: { version: 'desc' } })).version, version);
    for (const [user, held] of [[alice, pairA], [bob, pairB]] as const) await json(await request('/reservations/' + held.id + '/cancel', user.accessToken, 'POST', { expectedVersion: 1, reason: 'USER_REQUEST' }, 'capacity-cancel'), 201);
    await configure({ capacity: 1 });
    // Real database time expires the hold. A late paid event must never reclaim the sold slot.
    await configure({ holdSeconds: 1 }); const short = await hold(alice, await quote(alice, 7));
    await configure({ holdSeconds: 300 }); const nextQuote = await quote(bob, 7); await pause(1100);
    const next = await hold(bob, nextQuote); assert.equal((await json<Reservation>(await request('/reservations/' + short.id, alice.accessToken))).state, 'EXPIRED');
    const late = await event(alice, short.id, 'PAYMENT_SUCCEEDED'); assert.equal(late.reservation.state, 'REFUND_PENDING'); assert.equal(await db.reservationClaim.count({ where: { reservationId: short.id } }), 0); assert.equal(await db.reservationClaim.count({ where: { reservationId: next.id } }), 1);
    await event(alice, short.id, 'REFUND_SUCCEEDED');
    const oldQuote = await quote(alice, 8); await configure({ practiceMultiplierBps: 15000 }); await error(await request('/reservations', alice.accessToken, 'POST', agreement(oldQuote), 'stale-price'), 409, 'RESERVATION_QUOTE_POLICY_CHANGED');
    const changedQuote = await quote(alice, 8); assert.equal(changedQuote.details.amountKrw, 1500);
    await error(await request('/reservations', alice.accessToken, 'POST', { ...agreement(changedQuote), safetyRulesVersion: 'other' }, 'wrong-safety'), 422, 'RESERVATION_SAFETY_AGREEMENT_REQUIRED');
    await error(await request('/reservations', alice.accessToken, 'POST', { ...agreement(changedQuote), safetyAgreedAt: new Date(Date.now() - 3600000).toISOString() }, 'old-safety'), 422);
    await configure({ quoteSeconds: 1 }); const expires = await quote(alice, 9); await pause(1100); await error(await request('/reservations', alice.accessToken, 'POST', agreement(expires), 'expired-quote'), 409, 'RESERVATION_QUOTE_EXPIRED');
    await configure({ quoteSeconds: 300 }); const venueHold = await hold(alice, await quote(alice, 10));
    await configure({ active: false }); await error(await request(slotsPath, alice.accessToken), 422, 'RESERVATION_VENUE_UNAVAILABLE'); await error(await request('/reservation-quotes', alice.accessToken, 'POST', input(11), 'inactive'), 422);
    const disabledPayment = await event(alice, venueHold.id, 'PAYMENT_SUCCEEDED'); assert.equal(disabledPayment.reservation.state, 'REFUND_PENDING'); assert.equal(await db.reservationClaim.count({ where: { reservationId: venueHold.id } }), 0);
    await configure({ active: true, allowedModes: ['PRACTICE'], hours: policy.snapshot.hours.map(h => ({ ...h, openMinute: 540, closeMinute: 1260 })) });
    await error(await request('/reservation-quotes', alice.accessToken, 'POST', input(1, 'CHALLENGE'), 'mode-blocked'), 422, 'RESERVATION_MODE_UNAVAILABLE');
    await error(await request('/reservation-quotes', alice.accessToken, 'POST', { ...input(0), startsAt: date + 'T13:00:00.000Z' }, 'hours-blocked'), 422, 'RESERVATION_HOURS_UNAVAILABLE');
    await db.$transaction(async tx => { await writeRevision(tx, lotId, 2, { ...fixture.snapshot, active: false }); await tx.parkingLot.update({ where: { id: lotId }, data: { currentVersion: 2 } }); });
    await error(await request('/reservation-quotes', alice.accessToken, 'POST', input(1), 'lot-inactive'), 422, 'RESERVATION_VENUE_UNAVAILABLE');
    assert.equal((await json<Reservation>(await request('/reservations/' + reserved.id, winner.accessToken))).pricing.amountKrw, winIndex === 0 ? 1250 : 1750);
    const page = await json<{ items: Reservation[]; nextCursor: string }>(await request('/reservations?limit=1', alice.accessToken)); assert.equal(page.items.length, 1); assert.ok(page.nextCursor);
    await json(await request('/reservations?limit=1&cursor=' + page.nextCursor, alice.accessToken)); await error(await request('/reservations?limit=2&cursor=' + page.nextCursor, alice.accessToken), 400); await error(await request('/reservations?limit=1&cursor=' + page.nextCursor, outsider.accessToken), 400);
    // Vehicle access is account-owned, not installation-owned. Unlinking still revokes the credential.
    const link = await json<{ installationId: string; deviceCode: string; userCode: string }>(await request('/auth/vehicle-links', undefined, 'POST', {}), 201); installs.push(link.installationId);
    await json(await request('/auth/vehicle-links/approve', alice.accessToken, 'POST', { userCode: link.userCode })); const vehicle = await json<Token>(await request('/auth/vehicle-links/exchange', undefined, 'POST', { deviceCode: link.deviceCode }));
    assert.equal((await request('/reservations/' + short.id, vehicle.accessToken)).status, 200); assert.equal((await request('/auth/vehicle-links/' + link.installationId, alice.accessToken, 'DELETE')).status, 204); await error(await request('/reservations/' + short.id, vehicle.accessToken), 401);
    const child = spawn(process.execPath, ['dist/main.js'], { env: { ...env, PORT: '39074' }, stdio: ['ignore', 'ignore', 'ignore'] });
    try {
      let ready = false; for (let i = 0; i < 50; i++) { try { ready = (await fetch('http://127.0.0.1:39074/api/v1/health/ready')).status === 200; if (ready) break; } catch { /* Starting. */ } await pause(100); } assert.equal(ready, true);
      const persisted = await json<Reservation>(await fetch('http://127.0.0.1:39074/api/v1/reservations/' + reserved.id, { headers: { Authorization: 'Bearer ' + winner.accessToken } })); assert.equal(persisted.state, 'REFUNDED');
      const replay = await fetch('http://127.0.0.1:39074/api/v1' + path, { method: 'POST', headers: { Authorization: 'Bearer ' + winner.accessToken, 'Content-Type': 'application/json', 'Idempotency-Key': 'cancel-paid' }, body: JSON.stringify(cancel) }); assert.equal(replay.headers.get('Idempotency-Replayed'), 'true'); assert.deepEqual(await json(replay, 201), cancelled);
    } finally { if (child.exitCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await done; } }
    const rateKey = createHash('sha256').update('reservations-read:' + alice.userId).digest('hex'); await db.$executeRaw`INSERT INTO "AuthRateBucket" (key,"windowStart",count) VALUES (${rateKey},NOW(),300) ON CONFLICT (key) DO UPDATE SET "windowStart"=NOW(),count=300`; await error(await request('/reservations', alice.accessToken), 429, 'RATE_LIMITED'); await db.authRateBucket.deleteMany({ where: { key: rateKey } });
    const disabled = await createApp(readConfig({ ...env, DEV_RESERVATIONS_ENABLED: 'false' }), () => {}); await disabled.listen(0, '127.0.0.1'); try { await error(await fetch(await disabled.getUrl() + '/api/v1/reservations', { headers: { Authorization: 'Bearer ' + alice.accessToken } }), 403, 'RESERVATIONS_POLICY_DISABLED'); } finally { await disabled.close(); }
    assert.equal(await db.missionRun.count({ where: { userId: { in: users } } }), 0);
    for (const secret of [key, alice.accessToken, ...users, lotId, 'safetyAgreedAt', 'providerEventId']) assert.ok(!JSON.stringify(logs).includes(secret));
    if (process.env.RESERVATIONS_CAPTURE_DIR) {
      const examples = { 'reservation-policy.json': policyResponse, 'reservation-policy-written.json': policyWritten, 'reservation-challenge-quote.json': b, 'reservation-policy-write.json': JSON.parse(await readFile('fixtures/reservations/synthetic-policy.json', 'utf8')), 'reservation-slots.json': slots, 'reservation-quote-request.json': input(0), 'reservation-quote.json': a, 'reservation-hold.json': args[winIndex], 'reservation-held.json': reserved, 'reservation-cancel.json': cancel, 'reservation-cancelled.json': cancelled, 'reservation-sandbox-event.json': { kind: 'PAYMENT_SUCCEEDED' }, 'reservation-sandbox-receipt.json': paid, 'reservation-page.json': page, 'reservation-detail.json': await json(await request('/reservations/' + reserved.id, winner.accessToken)) };
      for (const [name, value] of Object.entries(examples)) await writeFile(process.env.RESERVATIONS_CAPTURE_DIR + '/' + name, JSON.stringify(value, null, 2) + '\n');
    }
  } finally {
    try {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_reservation_failure ON "ReservationMutation"'); await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_reservation_failure()');
      await db.reservationMutation.deleteMany({ where: { userId: { in: users } } }); await db.reservation.deleteMany({ where: { userId: { in: users } } }); await db.reservationQuote.deleteMany({ where: { userId: { in: users } } }); await db.reservationPolicy.deleteMany({ where: { lotId } });
      await db.parkingSpace.deleteMany({ where: { lotId } }); await db.lotDriveAisle.deleteMany({ where: { lotId } }); await db.lotPillar.deleteMany({ where: { lotId } }); await db.lotRamp.deleteMany({ where: { lotId } }); await db.lotEntrance.deleteMany({ where: { lotId } }); await db.lotZone.deleteMany({ where: { lotId } }); await db.lotFloor.deleteMany({ where: { lotId } }); await db.lotRevision.deleteMany({ where: { lotId } }); await db.parkingLot.deleteMany({ where: { id: lotId } });
      await db.vehiclePairing.deleteMany({ where: { installationId: { in: installs } } }); await db.authSession.deleteMany({ where: { userId: { in: users } } }); await db.installation.deleteMany({ where: { id: { in: installs } } }); await db.authIdentity.deleteMany({ where: { userId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.authRateBucket.deleteMany();
    } finally { await second.close(); await app.close(); }
  }
});
