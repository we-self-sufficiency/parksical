import { ApiError } from '../api-error.js';
import { fingerprint } from '../vehicle/normalization.js';
import { missionRules, validateRunResult, type MissionRules, type StagePlan } from '../missions/rules.js';
import type { RunResultDto } from '../missions/dto.js';

export const RANKING_VERSION = 'rankings-v1';
export function nextConsentVersion(version: number, enabled: boolean, requested: boolean) {
  if (!requested && !enabled) return version;
  // Reserve the final PostgreSQL Int version for an explicit withdrawal.
  if (version >= 2147483647 || requested && version >= 2147483646) throw new ApiError(409, 'RANKING_CONSENT_VERSION_LIMIT');
  return version + 1;
}
export const PUBLIC_POLICY_VERSION = 'rankings-public-v1';
export const rankingBoundary = { source: 'SYNTHETIC', physicalVerification: 'UNVERIFIED', operationalAllowed: false, rankingEligible: false, rewardEligible: false, operationalBlockers: ['D-02', 'D-04', 'D-05'] } as const;
export function rankingMonth(month: string) {
  if (!/^(20\d{2})-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'INVALID_RANKING_MONTH');
  const [year, m] = month.split('-').map(Number), start = new Date(Date.UTC(year!, m! - 1, 1) - 9 * 3600000), end = new Date(Date.UTC(year!, m!, 1) - 9 * 3600000);
  return { month, timezone: 'Asia/Seoul' as const, startsAt: start.toISOString(), endsAt: end.toISOString(), cutoffAt: new Date(end.getTime() + 72 * 3600000).toISOString() };
}
export function monthOf(date: Date) { return new Date(date.getTime() + 9 * 3600000).toISOString().slice(0, 7); }
export interface RankingInput {
  id: string; userId: string; installationId: string; source: string; mode: string; lotId: string; structureVersion: number; ruleVersion: string;
  rules: unknown; stages: unknown; startedAt: Date; receivedAt: Date;
  rankingRecord: { publicId: string; rankingVersion: string; version: number; invalidatedAt: Date | null; deletedAt: Date | null } | null;
  result: { source: string; outcome: string; stars: number; finishedAt: Date; elapsedMs: number; receivedAt: Date; report: unknown; assessment: unknown } | null;
}
export function rankingCohort(row: Pick<RankingInput, 'lotId' | 'structureVersion' | 'ruleVersion' | 'rules' | 'stages'>) {
  return { cohortKey: fingerprint({ version: RANKING_VERSION, lotId: row.lotId, structureVersion: row.structureVersion, ruleVersion: row.ruleVersion, rules: row.rules, stages: row.stages, vehicleCorrection: 'UNAVAILABLE' }), structureVersion: row.structureVersion, ruleVersion: row.ruleVersion, stageIds: (row.stages as StagePlan[]).map(s => s.stageId), vehicleCorrection: 'UNAVAILABLE' as const, comparability: 'SYNTHETIC_EQUAL_INPUTS_ONLY' as const };
}
export function recognition(row: RankingInput, month = monthOf(row.startedAt)) {
  const bounds = rankingMonth(month), record = row.rankingRecord, result = row.result;
  if (!record || record.rankingVersion !== RANKING_VERSION) return 'UNSUPPORTED_RANKING_VERSION';
  if (record.deletedAt) return 'DELETED';
  if (record.invalidatedAt) return 'INVALIDATED';
  if (row.source !== 'SYNTHETIC' || result && result.source !== 'SYNTHETIC') return 'SOURCE_UNSUPPORTED';
  if (row.mode !== 'CHALLENGE') return 'PRACTICE_EXCLUDED';
  if (monthOf(row.startedAt) !== month) return 'OUTSIDE_MONTH';
  if (row.receivedAt.getTime() >= Date.parse(bounds.cutoffAt) || result && result.receivedAt.getTime() >= Date.parse(bounds.cutoffAt)) return 'AFTER_CUTOFF';
  if (!result) return 'INCOMPLETE';
  if (result.outcome !== 'COMPLETED') return 'INCOMPLETE';
  try {
    if (fingerprint(row.rules) !== fingerprint(missionRules(row.ruleVersion))) return 'RULES_UNSUPPORTED';
    const plans = row.stages as StagePlan[], report = result.report as RunResultDto;
    if (plans.length < 1 || plans.length > 3 || plans.some(p => !['NO_STOP_RAMP', 'ONE_SHOT_REVERSE', 'SMOOTH_STEERING'].includes(p.missionCode))) return 'RULES_UNSUPPORTED';
    const checked = validateRunResult(plans, row.rules as MissionRules, row.startedAt, report, result.receivedAt);
    if (report.source !== 'SYNTHETIC' || checked.outcome !== result.outcome || checked.stars !== result.stars || report.elapsedMs !== result.elapsedMs || Date.parse(report.finishedAt) !== result.finishedAt.getTime() || fingerprint(checked) !== fingerprint(result.assessment)) return 'UNRECOGNIZED';
  } catch { return 'UNRECOGNIZED'; }
  return 'SYNTHETIC_CONSISTENT';
}
export interface RankingCandidate { userId: string; runId: string; publicEntryId: string; score: number; startedAt: string; installationId: string; }
export function candidate(row: RankingInput): RankingCandidate { return { userId: row.userId, runId: row.id, publicEntryId: row.rankingRecord!.publicId, score: row.result!.stars, startedAt: row.startedAt.toISOString(), installationId: row.installationId }; }
export function bestCandidates(rows: RankingCandidate[]) {
  const sorted = [...rows].sort((a, b) => b.score - a.score || (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0) || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  const seen = new Set<string>();
  return sorted.filter(r => { if (seen.has(r.userId)) return false; seen.add(r.userId); return true; });
}
export function ranked<T extends RankingCandidate>(rows: T[]) {
  let rank = 0, previous: number | null = null;
  return rows.map(row => { if (row.score !== previous) rank++; previous = row.score; return { ...row, rank }; });
}
