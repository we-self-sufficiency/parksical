import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { AuthService, type Principal } from '../auth/auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DatabaseService } from '../database.service.js';
import type { Prisma, RankingConsent } from '../generated/prisma/client.js';
import { asJson } from '../lots/store.js';
import { fingerprint } from '../vehicle/normalization.js';
import type { RankingConsentDto, RankingPageQuery, RankingQuery, RankingRecordMutationDto } from './dto.js';
import { bestCandidates, candidate, monthOf, PUBLIC_POLICY_VERSION, ranked, rankingBoundary, rankingCohort, rankingMonth, RANKING_VERSION, recognition, type RankingCandidate } from './rules.js';

type Tx = Prisma.TransactionClient;
const included = { result: true, rankingRecord: true } as const;
type Row = Prisma.MissionRunGetPayload<{ include: typeof included }>;
const MAX_ROWS = 10000;

@Injectable()
export class RankingService {
  constructor(private readonly auth: AuthService, private readonly database: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  enabled() { if (!this.config.devRankingsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv === 'production') throw new ApiError(403, 'RANKINGS_POLICY_DISABLED'); }
  private async lock(tx: Tx) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('synthetic-rankings-v1',0))`; }
  private async now(tx: Tx) { const rows = await tx.$queryRaw<{ epochMs: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "epochMs"`; return new Date(Number(rows[0]!.epochMs)); }
  private async locked<T>(p: Principal, work: (tx: Tx) => Promise<T>) {
    this.enabled(); return this.auth.forUser(p, async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'mission-user:' + p.userId},0))`; await this.lock(tx); return work(tx); });
  }
  private async owned(tx: Tx, p: Principal, id: string) {
    const row = await tx.missionRun.findFirst({ where: { id, userId: p.userId, mode: 'CHALLENGE' }, include: included });
    if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    if (!row.rankingRecord) throw new ApiError(503, 'RANKING_MIGRATION_REQUIRED');
    return row;
  }
  private async source(tx: Tx, lotId: string, month: string) {
    const bounds = rankingMonth(month);
    if (!await tx.parkingLot.findUnique({ where: { id: lotId }, select: { id: true } })) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    const rows = await tx.missionRun.findMany({ where: { lotId, mode: 'CHALLENGE', startedAt: { gte: new Date(bounds.startsAt), lt: new Date(bounds.endsAt) } }, include: included, take: MAX_ROWS + 1, orderBy: { id: 'asc' } });
    if (rows.length > MAX_ROWS) throw new ApiError(503, 'RANKING_DATA_LIMIT', 60);
    return { rows, bounds };
  }
  private recordView(row: Row) {
    const r = row.rankingRecord!;
    return { runId: row.id, lotId: row.lotId, month: monthOf(row.startedAt), rankingVersion: r.rankingVersion, recordVersion: r.version, recognition: recognition(row), invalidatedAt: r.invalidatedAt?.toISOString() ?? null, deletedAt: r.deletedAt?.toISOString() ?? null, ...rankingCohort(row), ...rankingBoundary };
  }
  async record(p: Principal, id: string) { return this.locked(p, async tx => this.recordView(await this.owned(tx, p, id))); }
  private consentView(row: RankingConsent | null) {
    return { version: row?.version ?? 0, policyVersion: PUBLIC_POLICY_VERSION, enabled: row?.enabled ?? false, nickname: row?.enabled ? row.nickname : null, agreedAt: row?.agreedAt?.toISOString() ?? null, changedAt: row?.changedAt.toISOString() ?? null, scope: 'ALL_SYNTHETIC_MONTHS', ...rankingBoundary };
  }
  async consent(p: Principal) { return this.locked(p, async tx => this.consentView(await tx.rankingConsent.findUnique({ where: { userId: p.userId } }))); }
  private async mutation(p: Principal, key: string | undefined, route: string, dto: unknown, work: (tx: Tx, requestHash: string) => Promise<{ body: unknown; replayed?: boolean }>) {
    if (!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY');
    return this.locked(p, async tx => {
      const requestHash = fingerprint({ route, dto }), old = await tx.rankingMutation.findUnique({ where: { userId_key: { userId: p.userId, key } } });
      if (old) { if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT'); return { body: old.response, replayed: true }; }
      if (await tx.rankingMutation.count({ where: { userId: p.userId } }) >= 4000) throw new ApiError(409, 'RANKING_MUTATION_LIMIT');
      const result = await work(tx, requestHash), body = asJson(result.body);
      await tx.rankingMutation.create({ data: { userId: p.userId, key, requestHash, response: body } });
      return { body, replayed: result.replayed ?? false };
    });
  }
  async setConsent(p: Principal, key: string | undefined, dto: RankingConsentDto) {
    return this.mutation(p, key, 'consent', dto, async tx => {
      const old = await tx.rankingConsent.findUnique({ where: { userId: p.userId } }), now = await this.now(tx);
      if ((old?.version ?? 0) !== dto.expectedVersion) throw new ApiError(409, 'RANKING_CONSENT_VERSION_CONFLICT');
      if (dto.enabled ? dto.agreedAt === null || Math.abs(Date.parse(dto.agreedAt) - now.getTime()) > 300000 : dto.agreedAt !== null) throw new ApiError(422, 'RANKING_CONSENT_TIME_INVALID');
      const data = { version: dto.expectedVersion + 1, policyVersion: dto.policyVersion, enabled: dto.enabled, agreedAt: dto.agreedAt ? new Date(dto.agreedAt) : null, changedAt: now };
      const row = old ? await tx.rankingConsent.update({ where: { userId: p.userId }, data }) : await tx.rankingConsent.create({ data: { userId: p.userId, nickname: 'P-' + randomUUID().replaceAll('-', '').slice(0, 12), ...data } });
      await tx.rankingConsentChange.create({ data: { userId: p.userId, ...data } });
      await tx.user.update({ where: { id: p.userId }, data: { rankingPublic: dto.enabled } });
      return { body: this.consentView(row) };
    });
  }
  async changeRecord(p: Principal, id: string, action: 'INVALIDATE' | 'DELETE', key: string | undefined, dto: RankingRecordMutationDto) {
    return this.mutation(p, key, action + ':' + id, dto, async (tx, requestHash) => {
      const row = await this.owned(tx, p, id), record = row.rankingRecord!;
      const duplicate = await tx.rankingMutation.findFirst({ where: { userId: p.userId, requestHash } });
      if (duplicate) return { body: duplicate.response, replayed: true };
      if (record.deletedAt || action === 'INVALIDATE' && record.invalidatedAt) throw new ApiError(409, 'RANKING_RECORD_ALREADY_REMOVED');
      if (record.version !== dto.expectedVersion) throw new ApiError(409, 'RANKING_RECORD_VERSION_CONFLICT');
      if (action === 'INVALIDATE' && !row.result) throw new ApiError(422, 'RANKING_RESULT_REQUIRED');
      const now = await this.now(tx);
      await tx.rankingRecord.update({ where: { runId: id }, data: { version: record.version + 1, ...(action === 'DELETE' ? { deletedAt: now, deletionReason: dto.reason } : { invalidatedAt: now, invalidationReason: dto.reason }) } });
      return { body: { runId: id, recordVersion: record.version + 1, action, reason: dto.reason, changedAt: now.toISOString(), ...rankingBoundary } };
    });
  }
  private async view(tx: Tx, lotId: string, q: RankingQuery) {
    const { rows, bounds } = await this.source(tx, lotId, q.month);
    const snapshot = await tx.rankingMonthSnapshot.findUnique({ where: { lotId_month_cohortKey: { lotId, month: q.month, cohortKey: q.cohortKey } } });
    let candidates: RankingCandidate[], cohort;
    if (snapshot) {
      // Privacy/invalidation overlay is always current, including after immutable finalization.
      const valid = new Set(rows.filter(r => r.rankingRecord && !r.rankingRecord.deletedAt && !r.rankingRecord.invalidatedAt).map(r => r.id));
      candidates = (snapshot.candidates as unknown as RankingCandidate[]).filter(c => valid.has(c.runId));
      cohort = snapshot.cohort;
    } else {
      const group = rows.filter(r => rankingCohort(r).cohortKey === q.cohortKey);
      candidates = bestCandidates(group.filter(r => recognition(r, q.month) === 'SYNTHETIC_CONSISTENT').map(candidate));
      cohort = group[0] ? rankingCohort(group[0]) : null;
    }
    const consents = await tx.rankingConsent.findMany({ where: { userId: { in: candidates.map(c => c.userId) }, enabled: true, policyVersion: PUBLIC_POLICY_VERSION } });
    const byUser = new Map(consents.map(c => [c.userId, c]));
    const visible = ranked(candidates.filter(c => byUser.has(c.userId)));
    const now = await this.now(tx), status = snapshot ? 'FINALIZED' : now.getTime() >= Date.parse(bounds.cutoffAt) ? 'READY_TO_FINALIZE' : 'PROVISIONAL';
    const context = { lotId, ...bounds, cohortKey: q.cohortKey, rankingVersion: RANKING_VERSION, cohort, status, finalizedAt: snapshot?.createdAt.toISOString() ?? null, snapshotId: snapshot?.id ?? null, tiePolicy: 'DENSE_SHARED_SCORE_EARLIEST_START_UUID_DISPLAY', scorePolicy: 'PERSONAL_BEST_STARS_NO_SPEED_BONUS', ...rankingBoundary };
    return { candidates, visible, byUser, context };
  }
  async board(p: Principal, lotId: string, q: RankingPageQuery) {
    return this.locked(p, async tx => {
      const { visible, byUser, context } = await this.view(tx, lotId, q), limit = q.limit ?? 20;
      const items = visible.map(c => ({ entryId: c.publicEntryId, rank: c.rank, score: c.score, nickname: byUser.get(c.userId)!.nickname }));
      const publicContext = visible.length ? context : { ...context, cohort: null, snapshotId: null, finalizedAt: null, status: context.status === 'FINALIZED' ? 'READY_TO_FINALIZE' : context.status };
      const viewHash = fingerprint({ context: publicContext, items }), binding = fingerprint({ lotId, month: q.month, cohortKey: q.cohortKey, limit, userId: p.userId });
      let offset = 0;
      if (q.cursor) {
        let cursor: { viewHash: string; binding: string; offset: number };
        try { cursor = JSON.parse(Buffer.from(q.cursor, 'base64url').toString()) as typeof cursor; } catch { throw new ApiError(400, 'INVALID_RANKING_CURSOR'); }
        if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor) || Object.keys(cursor).sort().join(',') !== 'binding,offset,viewHash' || cursor.binding !== binding || !Number.isInteger(cursor.offset) || cursor.offset < 1 || cursor.offset % limit !== 0) throw new ApiError(400, 'INVALID_RANKING_CURSOR');
        if (cursor.viewHash !== viewHash) throw new ApiError(409, 'RANKING_VIEW_CHANGED');
        offset = cursor.offset;
        if (offset >= items.length) throw new ApiError(400, 'INVALID_RANKING_CURSOR');
      }
      return { ...publicContext, items: items.slice(offset, offset + limit), nextCursor: items.length > offset + limit ? Buffer.from(JSON.stringify({ viewHash, binding, offset: offset + limit })).toString('base64url') : null };
    });
  }
  async me(p: Principal, lotId: string, q: RankingQuery) {
    return this.locked(p, async tx => {
      const { candidates, visible, byUser, context } = await this.view(tx, lotId, q), self = candidates.find(c => c.userId === p.userId);
      // Private users compare only against opted-in participants plus themselves, never hidden peers.
      const population = bestCandidates([...visible.filter(c => c.userId !== p.userId), ...(self ? [self] : [])]);
      const own = ranked(population).find(c => c.userId === p.userId);
      return { ...context, population: 'PUBLIC_PLUS_CALLER', publiclyListed: !!self && byUser.has(p.userId), bestRunId: self?.runId ?? null, score: self?.score ?? null, rank: own?.rank ?? null };
    });
  }
  async cohorts(p: Principal, lotId: string, month: string) {
    return this.locked(p, async tx => {
      const { rows, bounds } = await this.source(tx, lotId, month), keys = new Set(rows.map(r => rankingCohort(r).cohortKey));
      const snapshots = await tx.rankingMonthSnapshot.findMany({ where: { lotId, month }, take: 101 });
      for (const snapshot of snapshots) keys.add(snapshot.cohortKey);
      if (keys.size > 100 || snapshots.length > 100) throw new ApiError(503, 'RANKING_COHORT_LIMIT', 60);
      const consented = new Set((await tx.rankingConsent.findMany({ where: { enabled: true, policyVersion: PUBLIC_POLICY_VERSION, userId: { in: rows.map(r => r.userId) } }, select: { userId: true } })).map(c => c.userId));
      const valid = new Set(rows.filter(r => r.rankingRecord && !r.rankingRecord.deletedAt && !r.rankingRecord.invalidatedAt).map(r => r.id));
      const now = await this.now(tx), items = [];
      for (const cohortKey of [...keys].sort()) {
        const frozen = snapshots.find(s => s.cohortKey === cohortKey), group = rows.filter(r => rankingCohort(r).cohortKey === cohortKey);
        const candidates = frozen ? (frozen.candidates as unknown as RankingCandidate[]).filter(c => valid.has(c.runId)) : bestCandidates(group.filter(r => recognition(r, month) === 'SYNTHETIC_CONSISTENT').map(candidate));
        if (candidates.some(c => consented.has(c.userId))) items.push({ cohortKey, cohort: frozen?.cohort ?? rankingCohort(group[0]!), status: frozen ? 'FINALIZED' : now.getTime() >= Date.parse(bounds.cutoffAt) ? 'READY_TO_FINALIZE' : 'PROVISIONAL' });
      }
      return { lotId, ...bounds, items, rankingVersion: RANKING_VERSION, ...rankingBoundary };
    });
  }
  // Internal S-18 adapter only. No HTTP/admin route and no operational payout candidates.
  async finalizeSyntheticMonth(lotId: string, month: string, cohortKey: string) {
    this.enabled(); rankingMonth(month);
    if (!/^[a-f0-9]{64}$/.test(cohortKey)) throw new ApiError(400, 'INVALID_RANKING_COHORT');
    return this.database.client.$transaction(async tx => {
      await this.lock(tx);
      const now = await this.now(tx), view = await this.view(tx, lotId, { month, cohortKey });
      if (now.getTime() < Date.parse(view.context.cutoffAt)) throw new ApiError(409, 'RANKING_CUTOFF_PENDING');
      let snapshot = await tx.rankingMonthSnapshot.findUnique({ where: { lotId_month_cohortKey: { lotId, month, cohortKey } } });
      if (!snapshot) {
        if (!view.context.cohort) throw new ApiError(422, 'RANKING_COHORT_UNKNOWN');
        snapshot = await tx.rankingMonthSnapshot.create({ data: { lotId, month, cohortKey, rankingVersion: RANKING_VERSION, cutoffAt: new Date(view.context.cutoffAt), createdAt: now, inputHash: fingerprint({ candidates: view.candidates, cohort: view.context.cohort, bounds: rankingMonth(month), version: RANKING_VERSION }), candidates: asJson(view.candidates), cohort: asJson(view.context.cohort) } });
      }
      return { snapshotId: snapshot.id, inputHash: snapshot.inputHash, lotId, ...rankingMonth(month), cohortKey, rankingVersion: RANKING_VERSION, syntheticCandidates: ranked(view.candidates), operationalCandidates: [] as never[], ...rankingBoundary };
    }, { maxWait: 5000, timeout: 10000 });
  }
}
