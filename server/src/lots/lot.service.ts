import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthService, type Principal } from '../auth/auth.service.js';
import { ApiError } from '../api-error.js';
import { fingerprint } from '../vehicle/normalization.js';
import { type LotCreateDto, type LotReplaceDto } from './dto.js';
import { asJson, lotView, writeRevision } from './store.js';
import { validateSnapshot } from './validation.js';

@Injectable()
export class LotService {
  constructor(private readonly auth: AuthService) {}
  async save(p: Principal, key: string | undefined, dto: LotCreateDto | LotReplaceDto, id?: string) {
    if (!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY');
    const snapshot = { ...dto.snapshot, sourceUpdatedAt: new Date(dto.snapshot.sourceUpdatedAt).toISOString() };
    const requestHash = fingerprint({ route: id ? 'replace:' + id : 'create', ...dto, snapshot });
    return this.auth.forAdmin(p, async tx => {
      const existing = await tx.lotMutation.findUnique({ where: { authSessionId_key: { authSessionId: p.sessionId, key } } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { body: existing.response, replayed: true };
      }
      validateSnapshot(snapshot);
      const lock = id ? 'lot:' + id : 'lot-code:' + (dto as LotCreateDto).code;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      let lot;
      if (id) {
        const previous = await tx.parkingLot.findUnique({ where: { id } });
        if (!previous) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
        if (previous.currentVersion !== (dto as LotReplaceDto).expectedVersion) throw new ApiError(409, 'LOT_VERSION_CONFLICT');
        if (previous.currentVersion >= 2147483647) throw new ApiError(409, 'LOT_VERSION_EXHAUSTED');
        lot = await tx.parkingLot.update({ where: { id }, data: { currentVersion: { increment: 1 } } });
      } else {
        const code = (dto as LotCreateDto).code;
        if (await tx.parkingLot.findUnique({ where: { code } })) throw new ApiError(409, 'LOT_CODE_CONFLICT');
        lot = await tx.parkingLot.create({ data: { id: randomUUID(), code, currentVersion: 1 } });
      }
      const revision = await writeRevision(tx, lot.id, lot.currentVersion, snapshot);
      const body = asJson(lotView(lot, revision));
      await tx.lotMutation.create({ data: { authSessionId: p.sessionId, key, requestHash, response: body } });
      return { body, replayed: false };
    });
  }
  async get(p: Principal, id: string, version?: number) {
    if (version !== undefined && (!Number.isSafeInteger(version) || version < 1 || version > 2147483647)) throw new ApiError(400, 'INVALID_LOT_VERSION');
    return this.auth.forAdmin(p, async tx => {
      const lot = await tx.parkingLot.findUnique({ where: { id } });
      if (!lot) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      const row = await tx.lotRevision.findUnique({ where: { lotId_version: { lotId: id, version: version ?? lot.currentVersion } } });
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      return lotView(lot, row);
    });
  }
  async list(p: Principal, after?: string) {
    return this.auth.forAdmin(p, async tx => {
      const rows = await tx.parkingLot.findMany({ where: after ? { id: { gt: after } } : {}, orderBy: { id: 'asc' }, take: 51,
        include: { revisions: { orderBy: { version: 'desc' }, take: 1 } } });
      return { items: rows.slice(0, 50).map(r => ({ id: r.id, code: r.code, version: r.revisions[0]!.version, name: r.revisions[0]!.name,
        active: r.revisions[0]!.active, source: r.revisions[0]!.source })), nextCursor: rows.length > 50 ? rows[49]!.id : null };
    });
  }
}
