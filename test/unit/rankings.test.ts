import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readConfig } from '../../src/config.js';
import { missionCatalog, validateRunResult } from '../../src/missions/rules.js';
import type { LotCreateDto } from '../../src/lots/dto.js';
import type { RunResultDto } from '../../src/missions/dto.js';
import { RankingConsentDto, RankingPageQuery, RankingRecordMutationDto } from '../../src/rankings/dto.js';
import { bestCandidates, candidate, monthOf, nextConsentVersion, ranked, rankingBoundary, rankingCohort, rankingMonth, recognition, type RankingInput } from '../../src/rankings/rules.js';
const lot = JSON.parse(readFileSync('fixtures/lots/one-synthetic-lot.json', 'utf8')) as LotCreateDto;
const catalog = missionCatalog(lot.snapshot), reverse = catalog.items.find(i => i.missionCode === 'ONE_SHOT_REVERSE')!.stage!;
const scenarios = JSON.parse(readFileSync('fixtures/missions/result-scenarios.json', 'utf8')) as { scenarios: { name: string; result: RunResultDto }[] };
function row(): RankingInput {
  const report = structuredClone(scenarios.scenarios.find(s => s.name === 'reverse-success')!.result), startedAt = new Date('2026-10-31T14:59:59.500Z');
  report.finishedAt = new Date(startedAt.getTime() + report.elapsedMs).toISOString();
  const receivedAt = new Date('2026-11-01T00:00:00Z');
  return { id: '0001', userId: 'user1', installationId: 'install', source: 'SYNTHETIC', mode: 'CHALLENGE', lotId: 'lot', structureVersion: 1, ruleVersion: catalog.ruleVersion, rules: catalog.rules, stages: [reverse], startedAt, receivedAt, rankingRecord: { publicId: 'public1', rankingVersion: 'rankings-v1', version: 1, invalidatedAt: null, deletedAt: null }, result: { source: 'SYNTHETIC', outcome: report.outcome, stars: report.stars, finishedAt: new Date(report.finishedAt), elapsedMs: report.elapsedMs, receivedAt, report, assessment: validateRunResult([reverse], catalog.rules, startedAt, report, receivedAt) } };
}
test('KST month boundaries, leap day/year and exclusive 72h cutoff are stable', () => {
  const fixture = JSON.parse(readFileSync('fixtures/rankings/month-boundaries.json', 'utf8')) as { cases: { occurredAt: string; month: string }[] };
  for (const c of fixture.cases) assert.equal(monthOf(new Date(c.occurredAt)), c.month);
  assert.deepEqual(rankingMonth('2026-10'), { month: '2026-10', timezone: 'Asia/Seoul', startsAt: '2026-09-30T15:00:00.000Z', endsAt: '2026-10-31T15:00:00.000Z', cutoffAt: '2026-11-03T15:00:00.000Z' });
  assert.equal(rankingMonth('2024-02').endsAt, '2024-02-29T15:00:00.000Z');
  for (const m of ['2026-00', '2026-13', '26-11', '2026-1', '1999-12']) assert.throws(() => rankingMonth(m));
  const r = row(); r.result!.receivedAt = new Date('2026-11-03T14:59:59.999Z');
  // A cross-month result still belongs to its start month before the exclusive cutoff.
  assert.equal(recognition(r), 'SYNTHETIC_CONSISTENT');
  r.result!.receivedAt = new Date('2026-11-03T15:00:00.000Z'); assert.equal(recognition(r), 'AFTER_CUTOFF');
});
test('only complete consistent synthetic challenges enter a development ranking; never operational eligibility', () => {
  assert.equal(recognition(row()), 'SYNTHETIC_CONSISTENT');
  const checks: [Partial<RankingInput>, string][] = [[{ mode: 'PRACTICE' }, 'PRACTICE_EXCLUDED'], [{ source: 'APP_REPORTED' }, 'SOURCE_UNSUPPORTED'], [{ result: null }, 'INCOMPLETE'], [{ ruleVersion: 'missions-v2' }, 'UNRECOGNIZED']];
  for (const [patch, expected] of checks) assert.equal(recognition({ ...row(), ...patch }), expected);
  const r = row(); r.rankingRecord!.invalidatedAt = new Date(); assert.equal(recognition(r), 'INVALIDATED'); r.rankingRecord!.deletedAt = new Date(); assert.equal(recognition(r), 'DELETED');
  const corrupt = row(); corrupt.result!.stars = 2; assert.equal(recognition(corrupt), 'UNRECOGNIZED');
  const unchecked = row(); unchecked.result!.assessment = { consistencyStatus: 'CHECKED' }; assert.equal(recognition(unchecked), 'UNRECOGNIZED');
  assert.equal(rankingBoundary.rankingEligible, false); assert.equal(rankingBoundary.rewardEligible, false); assert.equal(rankingBoundary.operationalAllowed, false);
});
test('cohorts pin structure, frozen full rules and ordered plans; no invented vehicle correction', () => {
  const r = row(), k = rankingCohort(r).cohortKey;
  for (const patch of [{ lotId: 'other' }, { structureVersion: 2 }, { ruleVersion: 'missions-v2' }, { rules: { version: 'missions-v1', different: true } }, { stages: [{ ...reverse, parkingSpaceId: 'other' }] }]) assert.notEqual(rankingCohort({ ...r, ...patch }).cohortKey, k);
  const other = { ...r, userId: 'other', installationId: 'other', id: 'new' }; assert.equal(rankingCohort(other).cohortKey, k);
  assert.notEqual(rankingCohort({ ...r, stages: [reverse, catalog.items[0]!.stage] }).cohortKey, rankingCohort({ ...r, stages: [catalog.items[0]!.stage, reverse] }).cohortKey);
  assert.equal(rankingCohort(r).vehicleCorrection, 'UNAVAILABLE');
});
test('personal best precedes occurrence/UUID display order; equal scores share dense rank without speed incentives', () => {
  const a = candidate(row()), b = { ...a, userId: 'user2', runId: '0002', publicEntryId: 'public2' }, c = { ...b, runId: '0003', score: 2 }, d = { ...b, userId: 'user3', runId: '0004', score: 1 };
  const result = ranked(bestCandidates([d, c, b, a]));
  assert.deepEqual(result.map(c => [c.runId, c.rank]), [['0001', 1], ['0002', 1], ['0004', 2]]);
  assert.deepEqual(ranked(bestCandidates([a, b, c, d])), result);
  assert.equal(bestCandidates([a, { ...a, runId: '0000', startedAt: '2026-11-01T00:00:00.000Z' }])[0]!.runId, '0001');
});
test('strict consent/record/page DTOs reject string booleans, arbitrary nicknames and unsupported rules', () => {
  const dto = { expectedVersion: 0, policyVersion: 'rankings-public-v1', enabled: false, agreedAt: null };
  assert.deepEqual(validateSync(plainToInstance(RankingConsentDto, dto)), []);
  for (const patch of [{ enabled: 'true' }, { expectedVersion: -1 }, { policyVersion: 'future' }, { agreedAt: undefined }]) assert.ok(validateSync(plainToInstance(RankingConsentDto, { ...dto, ...patch })).length);
  assert.ok(validateSync(plainToInstance(RankingConsentDto, { ...dto, nickname: 'email@example.invalid' }), { whitelist: true, forbidNonWhitelisted: true }).length);
  assert.deepEqual(validateSync(plainToInstance(RankingPageQuery, { month: '2026-11', cohortKey: 'a'.repeat(64), limit: '20' })), []);
  for (const limit of ['1.0', '1e1', ' 20', '-1', '51', 0, null]) assert.ok(validateSync(plainToInstance(RankingPageQuery, { month: '2026-11', cohortKey: 'a'.repeat(64), limit })).length);
  assert.ok(validateSync(plainToInstance(RankingRecordMutationDto, { expectedVersion: 3, reason: 'restore' })).length);
});
test('ranking opt-in defaults off and never enables production or real rankings', () => {
  const env = { DATABASE_URL: 'postgresql://synthetic@localhost/test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: 'synthetic-config-key-at-least-32-characters' };
  assert.equal(readConfig(env).devRankingsEnabled, false);
  assert.equal(readConfig({ ...env, DEV_RANKINGS_ENABLED: 'true' }).devRankingsEnabled, true);
  for (const patch of [{ NODE_ENV: 'production' }, { DEV_AUTH_ENABLED: 'false' }, { DEV_RANKINGS_ENABLED: 'yes' }, { REAL_RANKINGS_ENABLED: 'true' }]) assert.throws(() => readConfig({ ...env, DEV_RANKINGS_ENABLED: 'true', ...patch }));
});

test('consent version limits reserve withdrawal and already-disabled no-op never overflows', () => {
  assert.equal(nextConsentVersion(1000, true, false), 1001);
  assert.equal(nextConsentVersion(2147483646, true, false), 2147483647);
  assert.equal(nextConsentVersion(2147483647, false, false), 2147483647);
  assert.equal(nextConsentVersion(0, false, false), 0);
  assert.throws(() => nextConsentVersion(2147483646, true, true));
  assert.throws(() => nextConsentVersion(2147483647, false, true));
});
