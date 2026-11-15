import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { AuthService, type Principal } from '../auth/auth.service.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { asJson } from '../lots/store.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { cursorLocation, locationCursor } from '../locations/pagination.js';
import type { RunPageQuery } from '../missions/dto.js';
import { fingerprint } from '../vehicle/normalization.js';
import type { ReservationCancelDto, ReservationHoldDto, ReservationPolicyWriteDto, ReservationQuoteDto, ReservationSandboxEventDto, ReservationSlotsQuery } from './dto.js';
import { RESERVATION_PAYMENTS, type ReservationPaymentPort } from './payment-port.js';
import { dayStart, HALF_HOUR_MS, horizon, inHours, localDay, quoteFare, slotsBetween, validatePeriod, validatePolicy, validateVehicle, type ReservationPolicySnapshot } from './rules.js';

type Tx = Prisma.TransactionClient;
type FullReservation = Prisma.ReservationGetPayload<{ include: { quote: true } }>;
export const reservationBoundary = { source: 'SYNTHETIC', operationalAllowed: false, realPaymentVerified: false, operationalBlockers: ['D-04', 'D-05'] } as const;

@Injectable()
export class ReservationService {
  constructor(private readonly auth: AuthService, @Inject(APP_CONFIG) private readonly config: AppConfig, @Inject(RESERVATION_PAYMENTS) private readonly payments: ReservationPaymentPort) {}
  enabled() { if (!this.config.devReservationsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv === 'production') throw new ApiError(403, 'RESERVATIONS_POLICY_DISABLED'); }
  private async now(tx: Tx) {
    // Epoch avoids session-timezone/raw timestamp decoding ambiguities across adapters.
    const rows = await tx.$queryRaw<{ epochMs: bigint }[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS "epochMs"`;
    return new Date(Number(rows[0]!.epochMs));
  }
  private async lotLock(tx: Tx, id: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:' + id},0))`; }
  private async locked<T>(p: Principal, work: (tx: Tx) => Promise<T>, admin = false) {
    this.enabled();
    const action = async (tx: Tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'reservation-user:' + p.userId},0))`; return work(tx); };
    return admin ? this.auth.forAdmin(p, action) : this.auth.forUser(p, action);
  }
  private async mutate(p: Principal, key: string | undefined, route: string, dto: unknown, action: (tx: Tx) => Promise<{ body: unknown; replayed?: boolean }>, admin = false) {
    if (!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY');
    const requestHash = fingerprint({ route, dto });
    return this.locked(p, async tx => {
      const old = await tx.reservationMutation.findUnique({ where: { userId_key: { userId: p.userId, key } } });
      if (old) { if (old.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT'); return { body: old.response, replayed: true }; }
      const result = await action(tx), body = asJson(result.body);
      await tx.reservationMutation.create({ data: { userId: p.userId, key, requestHash, response: body } });
      return { body, replayed: result.replayed ?? false };
    }, admin);
  }
  private async venue(tx: Tx, lotId: string) {
    const lot = await tx.parkingLot.findUnique({ where: { id: lotId } });
    if (!lot) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    const revision = await tx.lotRevision.findUniqueOrThrow({ where: { lotId_version: { lotId, version: lot.currentVersion } } });
    return { lot, revision, snapshot: revision.snapshot as unknown as LotSnapshotDto };
  }
  private async current(tx: Tx, lotId: string, requireAvailable = true) {
    const venue = await this.venue(tx, lotId), policy = await tx.reservationPolicy.findFirst({ where: { lotId }, orderBy: { version: 'desc' } });
    if (!policy) throw new ApiError(404, 'RESERVATION_POLICY_NOT_FOUND');
    const snapshot = policy.snapshot as unknown as ReservationPolicySnapshot;
    const available = snapshot.active && venue.revision.active && venue.revision.source === 'SYNTHETIC' && policy.structureVersion === venue.lot.currentVersion;
    if (requireAvailable && !available) throw new ApiError(422, 'RESERVATION_VENUE_UNAVAILABLE');
    return { ...venue, policy, snapshot, available };
  }
  private async sweep(tx: Tx, lotId: string, now: Date) {
    const expired = await tx.reservation.findMany({ where: { lotId, state: 'HELD', holdExpiresAt: { lte: now } }, select: { id: true } });
    if (!expired.length) return;
    const ids = expired.map(r => r.id);
    await tx.reservation.updateMany({ where: { id: { in: ids }, state: 'HELD' }, data: { state: 'EXPIRED', version: { increment: 1 }, updatedAt: now } });
    await tx.reservationClaim.deleteMany({ where: { reservationId: { in: ids } } });
  }
  private async counts(tx: Tx, lotId: string, starts: Date[], now: Date) {
    const rows = await tx.reservationClaim.groupBy({ by: ['startsAt'], where: { lotId, startsAt: { in: starts }, reservation: { OR: [{ state: 'SANDBOX_CONFIRMED' }, { state: 'HELD', holdExpiresAt: { gt: now } }] } }, _count: { _all: true } });
    return new Map(rows.map(r => [r.startsAt.getTime(), r._count._all]));
  }
  async policy(p: Principal, lotId: string) {
    return this.locked(p, async tx => { await this.lotLock(tx, lotId); const v = await this.current(tx, lotId, false); return { lotId, version: v.policy.version, snapshot: v.snapshot, currentlyAvailable: v.available, stepMinutes: 30, maxDurationMinutes: 240, horizonDays: 7, ...reservationBoundary }; });
  }
  async writePolicy(p: Principal, lotId: string, key: string | undefined, dto: ReservationPolicyWriteDto) {
    return this.mutate(p, key, 'policy:' + lotId, dto, async tx => {
      await this.lotLock(tx, lotId); const now = await this.now(tx), v = await this.venue(tx, lotId);
      const old = await tx.reservationPolicy.findFirst({ where: { lotId }, orderBy: { version: 'desc' } });
      if ((old?.version ?? 0) !== dto.expectedVersion) throw new ApiError(409, 'RESERVATION_POLICY_VERSION_CONFLICT');
      if (dto.expectedVersion >= 1000) throw new ApiError(409, 'RESERVATION_POLICY_VERSION_LIMIT');
      if (dto.snapshot.structureVersion !== v.lot.currentVersion) throw new ApiError(409, 'RESERVATION_STRUCTURE_CHANGED');
      const snapshot = validatePolicy(dto.snapshot, v.snapshot);
      await this.sweep(tx, lotId, now);
      if (snapshot.active) {
        const live = await tx.reservationClaim.groupBy({ by: ['startsAt'], where: { lotId, startsAt: { gte: new Date(Math.floor(now.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS) }, reservation: { OR: [{ state: 'SANDBOX_CONFIRMED' }, { state: 'HELD', holdExpiresAt: { gt: now } }] } }, _count: { _all: true } });
        if (live.some(s => s._count._all > snapshot.capacity)) throw new ApiError(409, 'RESERVATION_CAPACITY_BELOW_EXISTING');
      }
      const policy = await tx.reservationPolicy.create({ data: { lotId, version: dto.expectedVersion + 1, structureVersion: dto.snapshot.structureVersion, snapshot: asJson(snapshot) } });
      return { body: { lotId, version: policy.version, snapshot, ...reservationBoundary } };
    }, true);
  }
  async slots(p: Principal, lotId: string, q: ReservationSlotsQuery) {
    return this.locked(p, async tx => {
      await this.lotLock(tx, lotId); const now = await this.now(tx), v = await this.current(tx, lotId);
      validateVehicle(v.snapshot, q.mode, q.lengthMm, q.widthMm);
      const start = dayStart(q.date), end = new Date(start.getTime() + 86400000);
      if (start < dayStart(localDay(now).date) || start >= horizon(now)) throw new ApiError(422, 'RESERVATION_OUTSIDE_HORIZON');
      await this.sweep(tx, lotId, now);
      const starts = slotsBetween(start, end).filter(s => s > now && inHours(s, v.snapshot.hours));
      const counts = await this.counts(tx, lotId, starts, now);
      return { lotId, policyVersion: v.policy.version, structureVersion: v.policy.structureVersion, date: q.date, timezone: 'Asia/Seoul', mode: q.mode, stepMinutes: 30, capacity: v.snapshot.capacity, items: starts.map(s => ({ startsAt: s.toISOString(), endsAt: new Date(s.getTime() + HALF_HOUR_MS).toISOString(), remainingCapacity: Math.max(0, v.snapshot.capacity - (counts.get(s.getTime()) ?? 0)), available: (counts.get(s.getTime()) ?? 0) < v.snapshot.capacity })), ...reservationBoundary };
    });
  }
  async quote(p: Principal, key: string | undefined, dto: ReservationQuoteDto) {
    const input = { ...dto, startsAt: new Date(dto.startsAt).toISOString() };
    return this.mutate(p, key, 'quote', input, async tx => {
      await this.lotLock(tx, dto.lotId); const now = await this.now(tx), v = await this.current(tx, dto.lotId);
      validateVehicle(v.snapshot, dto.mode, dto.lengthMm, dto.widthMm);
      const start = new Date(input.startsAt), period = validatePeriod(v.snapshot, start, dto.durationMinutes, now), fare = quoteFare(v.snapshot, dto.mode, start, period.end);
      if (await tx.reservationQuote.count({ where: { userId: p.userId } }) >= 1000) throw new ApiError(409, 'RESERVATION_QUOTE_LIMIT');
      const id = randomUUID(), expiresAt = new Date(Math.min(start.getTime(), now.getTime() + v.snapshot.quoteSeconds * 1000));
      const details = { ...fare, lengthMm: dto.lengthMm, widthMm: dto.widthMm, safetyRulesVersion: v.snapshot.safetyRulesVersion, structureVersion: v.policy.structureVersion };
      const body = { quoteId: id, lotId: dto.lotId, policyVersion: v.policy.version, mode: dto.mode, startsAt: start.toISOString(), endsAt: period.end.toISOString(), createdAt: now.toISOString(), expiresAt: expiresAt.toISOString(), details, capacityReserved: false, ...reservationBoundary };
      await tx.reservationQuote.create({ data: { id, userId: p.userId, lotId: dto.lotId, policyVersion: v.policy.version, mode: dto.mode, startsAt: start, endsAt: period.end, amountKrw: fare.amountKrw, details: asJson(details), createdAt: now, expiresAt, receipt: asJson(body) } });
      return { body };
    });
  }
  private async owned(tx: Tx, p: Principal, id: string) {
    const row = await tx.reservation.findFirst({ where: { id, userId: p.userId }, include: { quote: true } });
    if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND'); return row;
  }
  private view(r: FullReservation) {
    return { id: r.id, quoteId: r.quoteId, lotId: r.lotId, policyVersion: r.quote.policyVersion, mode: r.quote.mode, startsAt: r.startsAt.toISOString(), endsAt: r.endsAt.toISOString(), state: r.state, paymentStatus: r.paymentStatus, version: r.version, holdExpiresAt: r.holdExpiresAt.toISOString(), safetyRulesVersion: r.safetyRulesVersion, safetyAgreedAt: r.safetyAgreedAt.toISOString(), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), pricing: r.quote.details, ...reservationBoundary };
  }
  async hold(p: Principal, key: string | undefined, dto: ReservationHoldDto) {
    const input = { ...dto, safetyAgreedAt: new Date(dto.safetyAgreedAt).toISOString() };
    return this.mutate(p, key, 'hold', input, async tx => {
      const quote = await tx.reservationQuote.findFirst({ where: { id: dto.quoteId, userId: p.userId } });
      if (!quote) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      await this.lotLock(tx, quote.lotId); const now = await this.now(tx), hash = fingerprint(input);
      const old = await tx.reservation.findUnique({ where: { quoteId: quote.id } });
      if (old) { if (old.creationHash !== hash) throw new ApiError(409, 'RESERVATION_QUOTE_ALREADY_USED'); return { body: old.creationReceipt, replayed: true }; }
      if (quote.expiresAt <= now) throw new ApiError(409, 'RESERVATION_QUOTE_EXPIRED');
      const v = await this.current(tx, quote.lotId);
      if (v.policy.version !== quote.policyVersion) throw new ApiError(409, 'RESERVATION_QUOTE_POLICY_CHANGED');
      if (dto.safetyRulesVersion !== v.snapshot.safetyRulesVersion || Math.abs(new Date(input.safetyAgreedAt).getTime() - now.getTime()) > 300000) throw new ApiError(422, 'RESERVATION_SAFETY_AGREEMENT_REQUIRED');
      const details = quote.details as { lengthMm: number; widthMm: number };
      validateVehicle(v.snapshot, quote.mode as 'CHALLENGE' | 'PRACTICE', details.lengthMm, details.widthMm);
      const period = validatePeriod(v.snapshot, quote.startsAt, (quote.endsAt.getTime() - quote.startsAt.getTime()) / 60000, now);
      await this.sweep(tx, quote.lotId, now);
      const overlap = await tx.reservation.findFirst({ where: { userId: p.userId, startsAt: { lt: quote.endsAt }, endsAt: { gt: quote.startsAt }, OR: [{ state: 'SANDBOX_CONFIRMED' }, { state: 'HELD', holdExpiresAt: { gt: now } }] } });
      if (overlap) throw new ApiError(409, 'RESERVATION_USER_OVERLAP');
      const counts = await this.counts(tx, quote.lotId, period.slots, now);
      if (period.slots.some(s => (counts.get(s.getTime()) ?? 0) >= v.snapshot.capacity)) throw new ApiError(409, 'RESERVATION_SLOT_FULL');
      if (await tx.reservation.count({ where: { userId: p.userId } }) >= 1000) throw new ApiError(409, 'RESERVATION_COUNT_LIMIT');
      const id = randomUUID(), holdExpiresAt = new Date(Math.min(quote.startsAt.getTime(), now.getTime() + v.snapshot.holdSeconds * 1000));
      const values = { id, userId: p.userId, quoteId: quote.id, lotId: quote.lotId, startsAt: quote.startsAt, endsAt: quote.endsAt, state: 'HELD', paymentStatus: 'NOT_STARTED', version: 1, holdExpiresAt, safetyRulesVersion: dto.safetyRulesVersion, safetyAgreedAt: new Date(input.safetyAgreedAt), createdAt: now, updatedAt: now, creationHash: hash };
      const body = this.view({ ...values, creationReceipt: {}, quote });
      await tx.reservation.create({ data: { ...values, creationReceipt: asJson(body) } });
      await tx.reservationClaim.createMany({ data: period.slots.map(startsAt => ({ reservationId: id, lotId: quote.lotId, startsAt })) });
      return { body };
    });
  }
  async get(p: Principal, id: string) {
    return this.locked(p, async tx => { const old = await this.owned(tx, p, id); await this.lotLock(tx, old.lotId); await this.sweep(tx, old.lotId, await this.now(tx)); return this.view(await this.owned(tx, p, id)); });
  }
  async list(p: Principal, q: RunPageQuery) {
    return this.locked(p, async tx => {
      const lots = await tx.reservation.findMany({ where: { userId: p.userId }, select: { lotId: true }, distinct: ['lotId'] });
      for (const id of lots.map(l => l.lotId).sort()) { await this.lotLock(tx, id); await this.sweep(tx, id, await this.now(tx)); }
      const limit = q.limit ?? 20, binding = p.userId + ':reservations';
      const rows = await tx.reservation.findMany({ where: { userId: p.userId }, include: { quote: true }, orderBy: [{ startsAt: 'desc' }, { id: 'desc' }] });
      const id = q.cursor ? cursorLocation(binding, limit, q.cursor) : null, index = id ? rows.findIndex(r => r.id === id) : -1;
      if (id && index < 0) throw new ApiError(400, 'INVALID_RESERVATION_CURSOR');
      const rest = rows.slice(index + 1);
      return { items: rest.slice(0, limit).map(r => this.view(r)), nextCursor: rest.length > limit ? locationCursor(binding, limit, rest[limit - 1]!.id) : null };
    });
  }
  private async action(tx: Tx, row: FullReservation, action: string, hash: string) {
    const old = await tx.reservationAction.findUnique({ where: { reservationId_action: { reservationId: row.id, action } } });
    if (!old) return null;
    if (old.requestHash !== hash) throw new ApiError(409, 'RESERVATION_ACTION_CONFLICT');
    return { body: old.response, replayed: true };
  }
  async cancel(p: Principal, id: string, key: string | undefined, dto: ReservationCancelDto) {
    return this.mutate(p, key, 'cancel:' + id, dto, async tx => {
      const old = await this.owned(tx, p, id); await this.lotLock(tx, old.lotId); const now = await this.now(tx);
      await this.sweep(tx, old.lotId, now); const row = await this.owned(tx, p, id), hash = fingerprint(dto), replay = await this.action(tx, row, 'CANCEL', hash); if (replay) return replay;
      if (row.version !== dto.expectedVersion) throw new ApiError(409, 'RESERVATION_VERSION_CONFLICT');
      if (!['HELD', 'SANDBOX_CONFIRMED'].includes(row.state) || row.startsAt <= now) throw new ApiError(409, 'RESERVATION_CANCELLATION_CLOSED');
      const paid = row.state === 'SANDBOX_CONFIRMED';
      const updated = await tx.reservation.update({ where: { id }, data: { state: paid ? 'REFUND_PENDING' : 'CANCELLED', paymentStatus: paid ? 'SANDBOX_REFUND_REQUIRED' : row.paymentStatus, version: { increment: 1 }, updatedAt: now }, include: { quote: true } });
      await tx.reservationClaim.deleteMany({ where: { reservationId: id } });
      const body = this.view(updated);
      await tx.reservationAction.create({ data: { reservationId: id, action: 'CANCEL', requestHash: hash, response: asJson(body) } });
      return { body };
    });
  }
  async sandboxEvent(p: Principal, id: string, key: string | undefined, dto: ReservationSandboxEventDto) {
    return this.mutate(p, key, 'sandbox-event:' + id, dto, async tx => {
      const old = await this.owned(tx, p, id);
      if(await tx.paymentOrder.findUnique({where:{reservationId:id}}))throw new ApiError(409,'RESERVATION_PAYMENT_ORDER_BOUND');
      await this.lotLock(tx, old.lotId); const now = await this.now(tx);
      await this.sweep(tx, old.lotId, now); const row = await this.owned(tx, p, id), hash = fingerprint(dto), replay = await this.action(tx, row, dto.kind, hash); if (replay) return replay;
      const evidence = this.payments.createSandboxEvidence(id, row.quote.amountKrw, dto.kind);
      if (evidence.source !== 'SANDBOX' || evidence.realPaymentVerified !== false || evidence.reservationId !== id || evidence.amountKrw !== row.quote.amountKrw || evidence.currency !== 'KRW' || evidence.kind !== dto.kind) throw new ApiError(422, 'INVALID_SANDBOX_PAYMENT_EVIDENCE');
      let state: string, paymentStatus: string;
      if (dto.kind === 'REFUND_SUCCEEDED') {
        if (row.state !== 'REFUND_PENDING') throw new ApiError(409, 'RESERVATION_PAYMENT_EVENT_CONFLICT');
        state = 'REFUNDED'; paymentStatus = 'SANDBOX_REFUNDED';
      } else if (dto.kind === 'PAYMENT_FAILED') {
        if (row.state !== 'HELD') throw new ApiError(409, 'RESERVATION_PAYMENT_EVENT_CONFLICT');
        state = 'PAYMENT_FAILED'; paymentStatus = 'SANDBOX_FAILED';
      } else {
        if (!['HELD', 'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED'].includes(row.state)) throw new ApiError(409, 'RESERVATION_PAYMENT_EVENT_CONFLICT');
        const v = await this.current(tx, row.lotId, false);
        const allowed = row.state === 'HELD' && row.holdExpiresAt > now && row.startsAt > now && v.available && v.policy.version === row.quote.policyVersion;
        state = allowed ? 'SANDBOX_CONFIRMED' : 'REFUND_PENDING'; paymentStatus = allowed ? 'SANDBOX_SUCCEEDED' : 'SANDBOX_REFUND_REQUIRED';
      }
      const updated = await tx.reservation.update({ where: { id }, data: { state, paymentStatus, version: { increment: 1 }, updatedAt: now }, include: { quote: true } });
      if (state !== 'SANDBOX_CONFIRMED') await tx.reservationClaim.deleteMany({ where: { reservationId: id } });
      const body = { reservation: this.view(updated), evidence };
      await tx.reservationAction.create({ data: { reservationId: id, action: dto.kind, requestHash: hash, response: asJson(body) } });
      return { body };
    });
  }

  // Internal S-16 port: caller holds reservation-user then payment-user locks. No client evidence enters here.
  async bindPayment(tx: Tx, userId: string, id: string) {
    this.enabled();
    const row=await tx.reservation.findFirst({where:{id,userId},include:{quote:true}});
    if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    await this.lotLock(tx,row.lotId); const now=await this.now(tx);
    await this.sweep(tx,row.lotId,now); const v=await this.current(tx,row.lotId,false);
    if(row.state!=='HELD' || row.paymentStatus!=='NOT_STARTED' || row.holdExpiresAt<=now || row.startsAt<=now || !v.available || v.policy.version!==row.quote.policyVersion)throw new ApiError(409,'RESERVATION_PAYMENT_CLOSED');
    return row;
  }
  async cancelPayment(tx: Tx, userId:string, id:string) {
    const row=await tx.reservation.findFirstOrThrow({where:{id,userId},include:{quote:true}});
    await this.lotLock(tx,row.lotId); const now=await this.now(tx); await this.sweep(tx,row.lotId,now);
    if(row.startsAt<=now)throw new ApiError(409,'RESERVATION_CANCELLATION_CLOSED');
    const current=await tx.reservation.findUniqueOrThrow({where:{id}});
    if(['HELD','SANDBOX_CONFIRMED'].includes(current.state)){
      const paid=current.state==='SANDBOX_CONFIRMED';
      await tx.reservation.update({where:{id},data:{state:paid?'REFUND_PENDING':'CANCELLED',paymentStatus:paid?'SANDBOX_REFUND_REQUIRED':'NOT_STARTED',version:{increment:1},updatedAt:now}});
      await tx.reservationClaim.deleteMany({where:{reservationId:id}});
    }
  }
  async applyPayment(tx:Tx, id:string, status:'SUCCEEDED'|'FAILED'|'REFUNDED'):Promise<boolean> {
    const old=await tx.reservation.findUniqueOrThrow({where:{id}}); await this.lotLock(tx,old.lotId);
    const now=await this.now(tx); await this.sweep(tx,old.lotId,now);
    const row=await tx.reservation.findUniqueOrThrow({where:{id},include:{quote:true}});
    let state=row.state,paymentStatus=row.paymentStatus;
    if(status==='FAILED' && state==='HELD'){state='PAYMENT_FAILED';paymentStatus='SANDBOX_FAILED';}
    if(status==='SUCCEEDED' && !['SANDBOX_CONFIRMED','REFUND_PENDING','REFUNDED'].includes(state)){
      const v=await this.current(tx,row.lotId,false);
      const allowed=state==='HELD' && row.holdExpiresAt>now && row.startsAt>now && v.available && v.policy.version===row.quote.policyVersion;
      state=allowed?'SANDBOX_CONFIRMED':'REFUND_PENDING';paymentStatus=allowed?'SANDBOX_SUCCEEDED':'SANDBOX_REFUND_REQUIRED';
    }
    // Refund-before-success notifications still pass through required compensation state.
    if(status==='REFUNDED' && !['REFUND_PENDING','REFUNDED'].includes(state)){
      await tx.reservation.update({where:{id},data:{state:'REFUND_PENDING',paymentStatus:'SANDBOX_REFUND_REQUIRED',version:{increment:1},updatedAt:now}});
      state='REFUND_PENDING';paymentStatus='SANDBOX_REFUND_REQUIRED';
    }
    if(status==='REFUNDED' && state==='REFUND_PENDING'){state='REFUNDED';paymentStatus='SANDBOX_REFUNDED';}
    const fresh=await tx.reservation.findUniqueOrThrow({where:{id}});
    if(state!==fresh.state)await tx.reservation.update({where:{id},data:{state,paymentStatus,version:{increment:1},updatedAt:now}});
    if(state!=='SANDBOX_CONFIRMED')await tx.reservationClaim.deleteMany({where:{reservationId:id}});
    return state==='REFUND_PENDING' || state==='REFUNDED';
  }
}
