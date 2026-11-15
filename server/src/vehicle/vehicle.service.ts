import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AuthService, type Principal } from '../auth/auth.service.js';
import { ApiError } from '../api-error.js';
import type { Prisma, VehicleSession } from '../generated/prisma/client.js';
import { SIGNALS, type CapabilitiesDto, type ClosePayloadDto, type VehicleEventDto, type VehicleSessionDto } from './dto.js';
import { fingerprint, normalizeCapabilities, validateCapabilities, validateClock, validateVersion } from './normalization.js';

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const keyPattern = /^[A-Za-z0-9_.-]{1,64}$/;
function checkKey(key: string | undefined): asserts key is string {
  if (!key || !keyPattern.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY');
}
function view(row: VehicleSession) {
  return { id: row.id, status: row.state, createdAt: row.createdAt.toISOString(), contractVersion: row.contractVersion,
    capabilities: row.capabilities, reportedSource: row.reportedSource, lastAppliedSequence: row.lastAppliedSequence, closedAt: row.closedAt?.toISOString() ?? null };
}

@Injectable()
export class VehicleService {
  constructor(private readonly auth: AuthService) {}

  async create(p: Principal, key: string | undefined, dto: VehicleSessionDto) {
    checkKey(key);
    if (dto.installationId !== p.installationId) throw new ApiError(403, 'INSTALLATION_NOT_LINKED');
    const capabilities = normalizeCapabilities(dto.capabilities);
    const reportedSource = dto.reportedSource ?? 'APP_REPORTED';
    const requestHash = fingerprint({ ...dto, capabilities, reportedSource });
    return this.auth.forVehicle(p, async tx => {
      const previous = await tx.vehicleSession.findUnique({ where: { authSessionId_creationKey: { authSessionId: p.sessionId, creationKey: key } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { body: previous.creationResponse, replayed: true };
      }
      const now = new Date();
      validateVersion(dto.contractVersion); validateCapabilities(dto.capabilities, now);
      const id = randomUUID();
      const body = { id, status: 'ACTIVE', createdAt: now.toISOString(), contractVersion: dto.contractVersion, capabilities,
        reportedSource, lastAppliedSequence: 0, closedAt: null };
      const row = await tx.vehicleSession.create({ data: { id, userId: p.userId, installationId: p.installationId!, authSessionId: p.sessionId,
        creationKey: key, requestHash, creationResponse: json(body), contractVersion: dto.contractVersion, appVersion: dto.appVersion,
        reportedSource, capabilities: json(capabilities), createdAt: now } });
      return { body: row.creationResponse, replayed: false };
    });
  }

  async get(p: Principal, id: string) {
    return this.auth.forVehicle(p, async tx => {
      const row = await tx.vehicleSession.findFirst({ where: { id, userId: p.userId, installationId: p.installationId!, authSessionId: p.sessionId } });
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      return view(row);
    });
  }

  async event(p: Principal, id: string, key: string | undefined, dto: VehicleEventDto) {
    checkKey(key);
    if (key !== dto.eventId) throw new ApiError(400, 'EVENT_KEY_MISMATCH');
    const payload = dto.type === 'CAPABILITIES_REPORTED' ? normalizeCapabilities(dto.payload as CapabilitiesDto) : { reason: (dto.payload as ClosePayloadDto).reason };
    const occurredAt = new Date(dto.occurredAt);
    const requestHash = fingerprint({ ...dto, occurredAt: occurredAt.toISOString(), payload });
    return this.auth.forVehicle(p, async tx => {
      const session = await tx.vehicleSession.findFirst({ where: { id, userId: p.userId, installationId: p.installationId!, authSessionId: p.sessionId } });
      if (!session) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      const previous = await tx.vehicleEvent.findUnique({ where: { sessionId_eventId: { sessionId: id, eventId: key } } });
      if (previous) {
        if (previous.requestHash !== requestHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT');
        return { body: previous.receipt, replayed: true };
      }
      if (session.state === 'CLOSED') throw new ApiError(409, 'SESSION_CLOSED');
      const now = new Date();
      validateVersion(dto.contractVersion); validateClock(dto.occurredAt, now);
      if (dto.type === 'CAPABILITIES_REPORTED') validateCapabilities(dto.payload as CapabilitiesDto, now);
      if (await tx.vehicleEvent.findUnique({ where: { sessionId_sequence: { sessionId: id, sequence: dto.sequence } } })) throw new ApiError(409, 'SEQUENCE_CONFLICT');

      const close = dto.type === 'SESSION_CLOSED';
      const inOrder = dto.sequence > session.lastAppliedSequence && (!session.lastAppliedOccurredAt || occurredAt >= session.lastAppliedOccurredAt);
      const disposition = close || inOrder ? 'APPLIED' : 'STORED_OUT_OF_ORDER';
      const lastAppliedSequence = close ? Math.max(dto.sequence, session.lastAppliedSequence) : inOrder ? dto.sequence : session.lastAppliedSequence;
      if (close) {
        await tx.vehicleSession.update({ where: { id }, data: { state: 'CLOSED', closedAt: now, lastAppliedSequence,
          lastAppliedOccurredAt: !session.lastAppliedOccurredAt || occurredAt > session.lastAppliedOccurredAt ? occurredAt : session.lastAppliedOccurredAt } });
      } else if (inOrder) {
        const current = session.capabilities as ReturnType<typeof normalizeCapabilities>;
        const incoming = payload as ReturnType<typeof normalizeCapabilities>;
        const merged = Object.fromEntries(SIGNALS.map(name => [name, new Date(incoming[name].checkedAt) >= new Date(current[name].checkedAt) ? incoming[name] : current[name]]));
        await tx.vehicleSession.update({ where: { id }, data: { capabilities: json(merged), lastAppliedSequence, lastAppliedOccurredAt: occurredAt } });
      }
      const receipt = { eventId: key, sessionId: id, receivedAt: now.toISOString(), disposition, lastAppliedSequence };
      const event = await tx.vehicleEvent.create({ data: { sessionId: id, eventId: key, sequence: dto.sequence, type: dto.type, payload: json(payload), requestHash, occurredAt, receivedAt: now, disposition, receipt: json(receipt) } });
      return { body: event.receipt, replayed: false };
    });
  }
}
