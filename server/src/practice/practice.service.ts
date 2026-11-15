import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { AuthService, type Principal } from '../auth/auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import type { MissionRun, PracticeRecognition, Prisma } from '../generated/prisma/client.js';
import { cursorLocation, locationCursor } from '../locations/pagination.js';
import { asJson } from '../lots/store.js';
import type { RunPageQuery, RunResultDto } from '../missions/dto.js';
import { fingerprint } from '../vehicle/normalization.js';
import type { PracticeInvalidateDto } from './dto.js';
import { comparePractice, goalSucceeded, practiceKey, practiceProgress, practiceRecommendation, practiceSummary, type PracticeInput } from './rules.js';

type Tx = Prisma.TransactionClient;
const included = { result: true, practiceRecord: true } as const;
type Row = Prisma.MissionRunGetPayload<{ include: typeof included }>;
export const practiceBoundary = { source: 'SYNTHETIC', physicalVerification: 'UNVERIFIED', operationalBlockers: ['D-02', 'D-04'], rankingEligible: false, rewardEligible: false, operationalChallengeAllowed: false } as const;

@Injectable()
export class PracticeService {
  constructor(private readonly auth: AuthService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  enabled() {
    if (!this.config.devMissionsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv === 'production') throw new ApiError(403, 'MISSIONS_POLICY_DISABLED');
  }
  private scope(p: Principal) { return { userId: p.userId, mode: 'PRACTICE', ...(p.kind === 'VEHICLE' ? { installationId: p.installationId! } : {}) }; }
  private async lock(tx: Tx, userId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'mission-user:' + userId},0))`; }
  private input(row: Row): PracticeInput {
    if (!row.practiceRecord) throw new ApiError(503, 'PRACTICE_MIGRATION_REQUIRED');
    return { ...row, goalVersion: row.practiceRecord.goalVersion, invalidated: row.practiceRecord.invalidatedAt !== null, report: row.result ? row.result.report as unknown as RunResultDto : null };
  }
  private async owned(tx: Tx, p: Principal, id: string) {
    const row = await tx.missionRun.findFirst({ where: { ...this.scope(p), id }, include: included });
    if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    return row;
  }
  private async cohort(tx: Tx, row: MissionRun) {
    const target = await tx.missionRun.findUniqueOrThrow({ where: { id: row.id }, include: included });
    const key = practiceKey(this.input(target));
    const rows = await tx.missionRun.findMany({ where: { userId: row.userId, installationId: row.installationId, lotId: row.lotId, structureVersion: row.structureVersion, ruleVersion: row.ruleVersion, mode: 'PRACTICE' }, include: included });
    return { target, key, rows: rows.map(r => this.input(r)).filter(r => practiceKey(r) === key) };
  }
  // Called inside the mission transaction and its shared per-user lock. GET refreshes legacy projections too.
  async reconcile(tx: Tx, row: MissionRun) {
    if (row.mode !== 'PRACTICE') return;
    const { key, rows, target } = await this.cohort(tx, row);
    return this.saveProgress(tx, target, key, rows);
  }
  private async saveProgress(tx: Tx, row: Row, key: string, rows: PracticeInput[], known?: PracticeRecognition | null) {
    const goalVersion = row.practiceRecord!.goalVersion;
    let recognition = known === undefined ? await tx.practiceRecognition.findUnique({ where: { cohortKey: key } }) : known;
    const progress = practiceProgress(rows, goalVersion);
    if (progress.qualified && (!recognition?.active || recognition.qualifyingRunId !== progress.qualifyingRunId)) {
      recognition = await tx.practiceRecognition.upsert({ where: { cohortKey: key }, create: { cohortKey: key, userId: row.userId, installationId: row.installationId, referenceRunId: row.id, goalVersion, active: true, qualifyingRunId: progress.qualifyingRunId }, update: { active: true, qualifyingRunId: progress.qualifyingRunId } });
    } else if (!progress.qualified && recognition?.active) {
      recognition = await tx.practiceRecognition.update({ where: { cohortKey: key }, data: { active: false, qualifyingRunId: null } });
    }
    return { cohortKey: key, installationId: row.installationId, lotId: row.lotId, structureVersion: row.structureVersion, ruleVersion: row.ruleVersion, stageIds: (rows[0]!.stages as { stageId: string }[]).map(s => s.stageId), goalVersion, currentStreak: progress.currentStreak, requiredStreak: progress.goal.consecutiveSuccesses, qualified: progress.qualified, qualifyingRunId: progress.qualifyingRunId, goal: progress.goal, recommendation: practiceRecommendation((rows[0]!.stages as unknown[]).length, progress.qualified), recognition: recognition ? { id: recognition.id, status: recognition.active ? 'ACTIVE' : 'REVOKED', stampCode: progress.goal.stampCode, titleCode: progress.goal.titleCode, qualifyingRunId: recognition.qualifyingRunId } : null, ...practiceBoundary };
  }
  private async locked<T>(p: Principal, work: (tx: Tx) => Promise<T>) {
    this.enabled();
    return this.auth.forUser(p, async tx => { await this.lock(tx, p.userId); return work(tx); });
  }
  private async report(tx: Tx, row: Row, cohortRows?: PracticeInput[]) {
    const rows = cohortRows ?? (await this.cohort(tx, row)).rows, input = this.input(row);
    return { runId: row.id, installationId: row.installationId, lotId: row.lotId, structureVersion: row.structureVersion, ruleVersion: row.ruleVersion, goalVersion: input.goalVersion, startedAt: row.startedAt.toISOString(), finishedAt: row.result?.finishedAt.toISOString() ?? null, outcome: row.result?.outcome ?? 'ACTIVE', recordVersion: input.invalidated ? 2 : 1, validity: input.invalidated ? 'INVALIDATED' : 'VALID', invalidatedAt: row.practiceRecord!.invalidatedAt?.toISOString() ?? null, invalidationReason: row.practiceRecord!.invalidationReason, goalSucceeded: goalSucceeded(input), summary: practiceSummary(input.report), comparison: comparePractice(input, rows), metricProvenance: 'APP_REPORTED_SYNTHETIC', rawTrajectoryAvailable: false, mapReplayAvailable: false, ...practiceBoundary };
  }
  async get(p: Principal, id: string) { return this.locked(p, async tx => this.report(tx, await this.owned(tx, p, id))); }
  async list(p: Principal, q: RunPageQuery) {
    return this.locked(p, async tx => {
      const limit = q.limit ?? 20, binding = p.userId + ':practice:' + p.kind + ':' + (p.installationId ?? 'web');
      const all = await tx.missionRun.findMany({ where: this.scope(p), include: included, orderBy: [{ startedAt: 'desc' }, { id: 'desc' }] });
      const id = q.cursor ? cursorLocation(binding, limit, q.cursor) : null, index = id ? all.findIndex(r => r.id === id) : -1;
      if (id && index < 0) throw new ApiError(400, 'INVALID_PRACTICE_CURSOR');
      const rows = all.slice(index + 1), inputs = all.map(r => this.input(r)), items = [];
      for (const row of rows.slice(0, limit)) {
        const key = practiceKey(this.input(row));
        items.push(await this.report(tx, row, inputs.filter(r => practiceKey(r) === key)));
      }
      return { items, nextCursor: rows.length > limit ? locationCursor(binding, limit, rows[limit - 1]!.id) : null };
    });
  }
  async progress(p: Principal, id: string) { return this.locked(p, async tx => this.reconcile(tx, await this.owned(tx, p, id))); }
  async awards(p: Principal, q: RunPageQuery) {
    return this.locked(p, async tx => {
      // Bounded by the existing 1,000 runs/account cap. Includes pre-S-13 finalized records.
      const rows = await tx.missionRun.findMany({ where: this.scope(p), include: included });
      const stored = await tx.practiceRecognition.findMany({ where: { userId: p.userId, ...(p.kind === 'VEHICLE' ? { installationId: p.installationId! } : {}) } });
      const groups = new Map<string, { reference: Row; inputs: PracticeInput[] }>(), all = [];
      for (const row of rows) {
        const input = this.input(row), key = practiceKey(input), group = groups.get(key);
        if (group) group.inputs.push(input); else groups.set(key, { reference: row, inputs: [input] });
      }
      for (const [key, group] of groups) {
        const state = await this.saveProgress(tx, group.reference, key, group.inputs, stored.find(a => a.cohortKey === key) ?? null);
        if (state.recognition) all.push(state);
      }
      all.sort((a, b) => a.recognition!.id < b.recognition!.id ? 1 : -1);
      const limit = q.limit ?? 20, binding = p.userId + ':practice-awards:' + p.kind + ':' + (p.installationId ?? 'web');
      const id = q.cursor ? cursorLocation(binding, limit, q.cursor) : null, index = id ? all.findIndex(a => a.recognition!.id === id) : -1;
      if (id && index < 0) throw new ApiError(400, 'INVALID_PRACTICE_CURSOR');
      const rest = all.slice(index + 1);
      return { items: rest.slice(0, limit), nextCursor: rest.length > limit ? locationCursor(binding, limit, rest[limit - 1]!.recognition!.id) : null };
    });
  }
  async invalidate(p: Principal, id: string, key: string | undefined, dto: PracticeInvalidateDto) {
    if (!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY');
    return this.locked(p, async tx => {
      const row = await this.owned(tx, p, id), input = this.input(row), requestHash = fingerprint({ route: 'practice-invalidate:' + id, dto });
      const old = await tx.practiceMutation.findUnique({ where: { userId_key: { userId: p.userId, key } } });
      if (old) {
        if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { body: old.response, replayed: true };
      }
      if (!row.result) throw new ApiError(422, 'PRACTICE_RESULT_REQUIRED');
      if (input.invalidated && row.practiceRecord!.invalidationReason !== dto.reason) throw new ApiError(409, 'PRACTICE_ALREADY_INVALIDATED');
      const at = row.practiceRecord!.invalidatedAt ?? new Date();
      if (!input.invalidated) await tx.practiceRecord.update({ where: { runId: id }, data: { invalidatedAt: at, invalidationReason: dto.reason } });
      await this.reconcile(tx, row);
      const body = asJson({ runId: id, recordVersion: 2, validity: 'INVALIDATED', invalidatedAt: at.toISOString(), reason: dto.reason });
      await tx.practiceMutation.create({ data: { userId: p.userId, key, runId: id, requestHash, response: body } });
      return { body, replayed: input.invalidated };
    });
  }
}
