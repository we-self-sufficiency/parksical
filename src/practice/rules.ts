import { ApiError } from '../api-error.js';
import type { RunResultDto } from '../missions/dto.js';
import { fingerprint } from '../vehicle/normalization.js';

export const PRACTICE_GOAL_VERSION = 'practice-v1';
export function practiceGoal(version = PRACTICE_GOAL_VERSION) {
  if (version !== PRACTICE_GOAL_VERSION) throw new ApiError(422, 'PRACTICE_GOAL_UNSUPPORTED');
  return { version, consecutiveSuccesses: 3, starsPerStage: 3, stampCode: 'THREE_PERFECT_PRACTICES', titleCode: 'PRACTICE_READY' } as const;
}
export interface PracticeInput {
  id: string; userId: string; installationId: string; lotId: string; structureVersion: number; ruleVersion: string;
  stages: unknown; startedAt: Date; goalVersion: string; invalidated: boolean; report: RunResultDto | null;
}
export function practiceKey(r: PracticeInput) {
  return fingerprint({ userId: r.userId, installationId: r.installationId, lotId: r.lotId, structureVersion: r.structureVersion, ruleVersion: r.ruleVersion, stages: r.stages, goalVersion: r.goalVersion });
}
export function goalSucceeded(r: PracticeInput) {
  const goal = practiceGoal(r.goalVersion), report = r.report;
  return !r.invalidated && report !== null && report.outcome === 'COMPLETED' && report.stages.length > 0 && report.stages.every(s => s.outcome === 'SUCCESS' && s.stars === goal.starsPerStage);
}
export function orderedPractice(rows: PracticeInput[]) {
  return [...rows].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function practiceProgress(rows: PracticeInput[], version = PRACTICE_GOAL_VERSION) {
  const goal = practiceGoal(version);
  let streak = 0, qualifyingRunId: string | null = null;
  for (const row of orderedPractice(rows)) {
    if (row.goalVersion !== version) throw new ApiError(422, 'PRACTICE_GOAL_MISMATCH');
    streak = goalSucceeded(row) ? streak + 1 : 0;
    if (streak === goal.consecutiveSuccesses && qualifyingRunId === null) qualifyingRunId = row.id;
  }
  return { currentStreak: streak, qualifyingRunId, qualified: qualifyingRunId !== null, goal };
}
export function practiceSummary(report: RunResultDto | null) {
  if (!report) return { gearTransitionCount: null, abruptSteeringCount: null, elapsedMs: null };
  // Empty/partial/quality-degraded reports cannot claim a complete observed zero.
  const complete = report.outcome === 'COMPLETED' && report.stages.length > 0;
  const sum = (name: 'gearTransitionCount' | 'abruptSteeringCount', signal: 'gear' | 'steeringAngle') => {
    if (!complete || report.stages.some(s => s.metrics[name] == null || s.quality.find(q => q.signal === signal)?.status !== 'AVAILABLE')) return null;
    return report.stages.reduce((n, s) => n + s.metrics[name]!, 0);
  };
  return { gearTransitionCount: sum('gearTransitionCount', 'gear'), abruptSteeringCount: sum('abruptSteeringCount', 'steeringAngle'), elapsedMs: report.elapsedMs };
}
export function comparePractice(current: PracticeInput, rows: PracticeInput[]) {
  const ordered = orderedPractice(rows), index = ordered.findIndex(r => r.id === current.id);
  const previous = ordered.slice(0, index).reverse().find(r => !r.invalidated && r.report?.outcome === 'COMPLETED');
  const summary = practiceSummary(current.report), before = previous ? practiceSummary(previous.report) : null;
  const delta = (key: keyof typeof summary) => current.invalidated || current.report?.outcome !== 'COMPLETED' || before?.[key] == null || summary[key] === null ? null : summary[key]! - before[key]!;
  return { previousRunId: previous?.id ?? null, delta: { gearTransitionCount: delta('gearTransitionCount'), abruptSteeringCount: delta('abruptSteeringCount'), elapsedMs: delta('elapsedMs') }, fasterTimeRewarded: false as const };
}

// A reversible synthetic workload recommendation, not a certified physical difficulty level.
export function practiceRecommendation(stageCount: number, qualified: boolean) {
  return { basis: 'STAGE_COUNT_TEST_POLICY', currentStageCount: stageCount, suggestedStageCount: qualified ? Math.min(3, stageCount + 1) : stageCount, code: !qualified ? 'REPEAT_CURRENT_GOAL' : stageCount < 3 ? 'REVIEW_ADDITIONAL_STAGE' : 'MAINTAIN_CURRENT_GOAL', requiresCatalogAndCapabilityReview: true, operationalAllowed: false } as const;
}
