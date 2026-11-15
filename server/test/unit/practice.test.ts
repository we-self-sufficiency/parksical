import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PracticeInvalidateDto } from '../../src/practice/dto.js';
import { RunResultDto } from '../../src/missions/dto.js';
import { comparePractice, goalSucceeded, practiceGoal, practiceKey, practiceProgress, practiceRecommendation, practiceSummary, type PracticeInput } from '../../src/practice/rules.js';
const fixture = JSON.parse(readFileSync('fixtures/missions/result-scenarios.json', 'utf8')) as { scenarios: { name: string; result: RunResultDto }[] };
const success = () => structuredClone(fixture.scenarios.find(r => r.name === 'reverse-success')!.result);
const row = (i: number): PracticeInput => ({ id: String(i).padStart(4, '0'), userId: 'user', installationId: 'install', lotId: 'lot', structureVersion: 1, ruleVersion: 'missions-v1', stages: [{ stageId: 'ONE_SHOT_REVERSE:s03' }], goalVersion: 'practice-v1', startedAt: new Date(i * 2000), invalidated: false, report: success() });

test('shared practice cases grant on the sixth run and treat pending/abort/unknown/invalidation as barriers', () => {
  const cases = JSON.parse(readFileSync('fixtures/practice/streak-scenarios.json', 'utf8')) as { scenarios: { name: string; outcomes: string[]; qualifyingIndex: number | null; currentStreak: number }[] };
  for (const c of cases.scenarios) {
    const rows = c.outcomes.map((outcome, i) => {
      const r = row(i);
      if (outcome === 'ACTIVE') r.report = null;
      else if (outcome === 'INVALIDATED') r.invalidated = true;
      else if (outcome !== 'SUCCESS') { r.report!.outcome = outcome === 'FAILED' ? 'COMPLETED' : outcome as 'ABORTED' | 'UNVERIFIABLE'; r.report!.stages[0]!.outcome = outcome as 'FAILED' | 'ABORTED' | 'UNVERIFIABLE'; }
      return r;
    });
    const result = practiceProgress(rows);
    assert.equal(result.qualifyingRunId, c.qualifyingIndex === null ? null : rows[c.qualifyingIndex]!.id, c.name);
    assert.equal(result.currentStreak, c.currentStreak, c.name);
  }
});
test('occurrence then stable UUID order, late failure and invalidation revoke earlier provisional qualification', () => {
  const rows = [row(0), row(2), row(4)];
  assert.equal(practiceProgress([...rows].reverse()).qualified, true);
  const late = row(1); late.report!.stages[0]!.outcome = 'FAILED';
  assert.equal(practiceProgress([...rows, late]).qualified, false);
  const tied = [row(1), row(2), row(3)].map(r => ({ ...r, startedAt: new Date(0) }));
  assert.equal(practiceProgress(tied.reverse()).qualifyingRunId, '0003');
  tied[1]!.invalidated = true; assert.equal(practiceProgress(tied).qualified, false);
});
test('cohorts isolate installation, lot, structure, mission rule, ordered stages and goal versions', () => {
  const base = row(0), key = practiceKey(base);
  assert.equal(practiceKey({ ...base, id: 'other', startedAt: new Date(100), report: null }), key);
  for (const patch of [{ installationId: 'other' }, { lotId: 'other' }, { structureVersion: 2 }, { ruleVersion: 'missions-v2' }, { goalVersion: 'practice-v2' }, { stages: [{ stageId: 'different' }] }]) assert.notEqual(practiceKey({ ...base, ...patch }), key);
  assert.throws(() => practiceGoal('practice-v2')); assert.throws(() => practiceProgress([{ ...base, goalVersion: 'practice-v2' }]));
  assert.equal(practiceKey({ ...base, stages: [{ a: 1, b: 2 }] }), practiceKey({ ...base, stages: [{ b: 2, a: 1 }] }));
});
test('only complete perfect stages meet the goal; duration is never a qualification incentive', () => {
  const r = row(0); assert.equal(goalSucceeded(r), true);
  r.report!.elapsedMs *= 2; assert.equal(goalSucceeded(r), true);
  r.report!.stages[0]!.stars = 2; assert.equal(goalSucceeded(r), false);
  r.report!.stages = []; assert.equal(goalSucceeded(r), false);
  assert.equal(practiceRecommendation(1, true).suggestedStageCount, 2); assert.equal(practiceRecommendation(3, true).suggestedStageCount, 3); assert.equal(practiceRecommendation(2, false).suggestedStageCount, 2); assert.equal(practiceRecommendation(1, true).operationalAllowed, false);
});
test('legacy missing counts stay null, comparisons do not invent gear changes or reward faster time', () => {
  const first = row(0), next = row(1);
  assert.deepEqual(practiceSummary(null), { gearTransitionCount: null, abruptSteeringCount: null, elapsedMs: null });
  assert.equal(practiceSummary(first.report).gearTransitionCount, null);
  first.report!.stages[0]!.metrics.gearTransitionCount = 4;
  next.report!.stages[0]!.metrics.gearTransitionCount = 2;
  assert.equal(comparePractice(next, [next, first]).delta.gearTransitionCount, -2);
  assert.equal(comparePractice(next, [next, first]).fasterTimeRewarded, false);
  first.invalidated = true; assert.equal(comparePractice(next, [first, next]).previousRunId, null);
  next.report!.outcome = 'ABORTED'; assert.equal(practiceSummary(next.report).gearTransitionCount, null);
});
test('optional gear count and invalidation DTO reject strings/range/unknown reasons while old results remain valid', () => {
  const r = success(); assert.deepEqual(validateSync(plainToInstance(RunResultDto, r)), []);
  r.stages[0]!.metrics.gearTransitionCount = 2; assert.deepEqual(validateSync(plainToInstance(RunResultDto, r)), []);
  for (const gearTransitionCount of [-1, 10001, '2']) assert.ok(validateSync(plainToInstance(RunResultDto, { ...r, stages: [{ ...r.stages[0], metrics: { ...r.stages[0]!.metrics, gearTransitionCount } }] })).length);
  assert.deepEqual(validateSync(plainToInstance(PracticeInvalidateDto, { expectedVersion: 1, reason: 'CORRECTION' })), []);
  for (const dto of [{ expectedVersion: 2, reason: 'CORRECTION' }, { expectedVersion: 1, reason: 'restore' }]) assert.ok(validateSync(plainToInstance(PracticeInvalidateDto, dto)).length);
});
