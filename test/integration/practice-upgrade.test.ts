import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import { writeRevision, asJson } from '../../src/lots/store.js';
import { missionCatalog } from '../../src/missions/rules.js';

test('real PG S-12/S-13 upgrade preserves immutable data through practice, reservations and ranking membership without consent or fabricated recognition', async () => {
  const schema = 'practice_upgrade_' + randomUUID().replaceAll('-', ''), sql = new Client({ connectionString: process.env.DATABASE_URL });
  await sql.connect(); await sql.query('CREATE SCHEMA "' + schema + '"'); await sql.query('SET search_path TO "' + schema + '"');
  const url = new URL(process.env.DATABASE_URL!); url.searchParams.set('options', '-c search_path=' + schema);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema }) });
  const migration = '20261115020000_practice_reports';
  try {
    for (const name of (await readdir('prisma/migrations')).filter(n => /^\d/.test(n) && n < migration).sort()) await sql.query(await readFile('prisma/migrations/' + name + '/migration.sql', 'utf8'));
    const snapshot = (JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json', 'utf8')) as LotCreateDto).snapshot;
    const catalog = missionCatalog(snapshot), stage = catalog.items.find(i => i.missionCode === 'ONE_SHOT_REVERSE')!.stage!;
    const user = await db.user.create({ data: {} }), installation = await db.installation.create({ data: { secretHash: '0'.repeat(64), linkedUserId: user.id } });
    const auth = await db.authSession.create({ data: { userId: user.id, provider: 'DEV', kind: 'VEHICLE', installationId: installation.id, accessHash: '1'.repeat(64), accessExpiresAt: new Date(Date.now() + 3600000), refreshExpiresAt: new Date(Date.now() + 3600000) } });
    const vehicle = await db.vehicleSession.create({ data: { userId: user.id, installationId: installation.id, authSessionId: auth.id, creationKey: 'legacy', requestHash: '2'.repeat(64), creationResponse: {}, contractVersion: '1.0', appVersion: 'synthetic', reportedSource: 'SYNTHETIC', capabilities: {} } });
    const lot = await db.parkingLot.create({ data: { code: randomUUID(), currentVersion: 1 } }); await db.$transaction(tx => writeRevision(tx, lot.id, 1, snapshot));
    const fixture = JSON.parse(await readFile('fixtures/missions/result-scenarios.json', 'utf8')) as { scenarios: { name: string; result: unknown }[] };
    for (let n = 0; n < 4; n++) {
      const run = await db.missionRun.create({ data: { userId: user.id, installationId: installation.id, authSessionId: auth.id, vehicleSessionId: vehicle.id, clientRunId: 'legacy-' + n, creationHash: '3'.repeat(64), creationResponse: {}, source: 'SYNTHETIC', mode: n === 3 ? 'CHALLENGE' : 'PRACTICE', lotId: lot.id, structureVersion: 1, ruleVersion: 'missions-v1', rules: asJson(catalog.rules), stages: asJson([stage]), capabilities: {}, startedAt: new Date(n * 2000) } });
      await db.missionRunResult.create({ data: { runId: run.id, clientResultId: 'legacy-result', requestHash: '4'.repeat(64), source: 'SYNTHETIC', outcome: 'COMPLETED', stars: 3, finishedAt: new Date(n * 2000 + 1000), elapsedMs: 1000, report: asJson(fixture.scenarios.find(s => s.name === 'reverse-success')!.result), assessment: {}, receipt: { legacy: true } } });
    }
    const before = await db.missionRun.findMany({ include: { result: true }, orderBy: { id: 'asc' } });
    await sql.query(await readFile('prisma/migrations/' + migration + '/migration.sql', 'utf8'));
    assert.deepEqual(await db.missionRun.findMany({ include: { result: true }, orderBy: { id: 'asc' } }), before);
    const enrolled = await db.practiceRecord.findMany({ include: { run: true } }); assert.equal(enrolled.length, 3); assert.ok(enrolled.every(r => r.goalVersion === 'practice-v1' && r.run.mode === 'PRACTICE' && r.invalidatedAt === null));
    assert.equal(await db.practiceRecognition.count(), 0, 'backfill membership is separate from lazy award projection');
    await sql.query(await readFile('prisma/migrations/20261115030000_reservations/migration.sql', 'utf8'));
    assert.deepEqual(await db.missionRun.findMany({ include: { result: true }, orderBy: { id: 'asc' } }), before);
    assert.equal(await db.reservation.count(), 0); assert.equal(await db.reservationPolicy.count(), 0); assert.equal(await db.reservationQuote.count(), 0);
    await sql.query(await readFile('prisma/migrations/20261115040000_rankings/migration.sql', 'utf8'));
    assert.deepEqual(await db.missionRun.findMany({ include: { result: true }, orderBy: { id: 'asc' } }), before);
    const rankingRecords = await db.rankingRecord.findMany({ include: { run: true } });
    assert.equal(rankingRecords.length, 1); assert.equal(rankingRecords[0]!.run.mode, 'CHALLENGE'); assert.equal(rankingRecords[0]!.version, 1); assert.equal(rankingRecords[0]!.deletedAt, null);
    assert.equal(await db.rankingConsent.count(), 0); assert.equal(await db.rankingMonthSnapshot.count(), 0);
    await sql.query(await readFile('prisma/migrations/20261115050000_payments/migration.sql','utf8'));
    assert.deepEqual(await db.missionRun.findMany({include:{result:true},orderBy:{id:'asc'}}),before);
    assert.equal(await db.paymentOrder.count(),0);assert.equal(await db.paymentQuote.count(),0);assert.equal(await db.sandboxProviderPayment.count(),0);
    const legacyQuote=randomUUID(),legacyOrder=randomUUID(),created=new Date(),start=new Date(created.getTime()+86400000),expires=new Date(created.getTime()+300000),pricing={currency:'KRW',priceVersion:'prepayment-v1',amountKrw:1000};
    await sql.query('INSERT INTO "PaymentQuote" (id,"userId","lotId","structureVersion","startsAt","endsAt","amountKrw",details,"createdAt","expiresAt",receipt) VALUES ($1,$2,$3,1,$4,$5,1000,$6,$7,$8,$9)',[legacyQuote,user.id,lot.id,start,new Date(start.getTime()+1800000),pricing,created,expires,{}]);
    await sql.query('INSERT INTO "PaymentOrder" (id,"userId","quoteId","lotId","amountKrw",currency,pricing,state,"createdAt","expiresAt","creationReceipt") VALUES ($1,$2,$3,$4,1000,\'KRW\',$5,\'CREATED\',$6,$7,$8)',[legacyOrder,user.id,legacyQuote,lot.id,pricing,created,expires,{}]);
    const legacyBefore=(await sql.query('SELECT to_jsonb(o) AS row FROM "PaymentOrder" o WHERE id=$1',[legacyOrder])).rows[0];
    await sql.query(await readFile('prisma/migrations/20261115060000_subscriptions/migration.sql','utf8'));
    assert.deepEqual(await db.missionRun.findMany({include:{result:true},orderBy:{id:'asc'}}),before);
    assert.equal(await db.subscription.count(),0);assert.equal(await db.subscriptionCycle.count(),0);assert.equal(await db.paymentOrder.count(),1);
    assert.deepEqual((await sql.query('SELECT to_jsonb(o)-\'subscriptionCycleId\' AS row FROM "PaymentOrder" o WHERE id=$1',[legacyOrder])).rows[0],legacyBefore);
    assert.equal((await db.paymentOrder.findUniqueOrThrow({where:{id:legacyOrder}})).subscriptionCycleId,null);
    await assert.rejects(db.rankingRecord.update({ where: { runId: rankingRecords[0]!.runId }, data: { rankingVersion: 'rankings-v2' } }));
    await assert.rejects(db.practiceRecord.update({ where: { runId: enrolled[0]!.runId }, data: { goalVersion: 'practice-v2' } }));
    await assert.rejects(db.missionRunResult.update({ where: { runId: enrolled[0]!.runId }, data: { stars: 1 } }));
  } finally { await db.$disconnect(); await sql.query('DROP SCHEMA "' + schema + '" CASCADE'); await sql.end(); }
});
