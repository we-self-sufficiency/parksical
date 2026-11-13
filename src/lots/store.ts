import type { Prisma, LotRevision, ParkingLot } from '../generated/prisma/client.js';
import type { LotSnapshotDto } from './dto.js';

export const asJson = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export function lotView(lot: ParkingLot, revision: LotRevision) {
  return { id: lot.id, code: lot.code, version: revision.version, currentVersion: lot.currentVersion,
    createdAt: lot.createdAt.toISOString(), revisionCreatedAt: revision.createdAt.toISOString(), snapshot: revision.snapshot };
}
export async function writeRevision(tx: Prisma.TransactionClient, lotId: string, version: number, s: LotSnapshotDto) {
  const revision = await tx.lotRevision.create({ data: { lotId, version, name: s.name, active: s.active, latitude: s.latitude, longitude: s.longitude,
    ownership: s.ownership, parkingType: s.parkingType, partnered: s.partnered, builtYear: s.builtYear, source: s.source,
    sourceUpdatedAt: new Date(s.sourceUpdatedAt), structureStatus: s.structureStatus, challengeAllowed: false, snapshot: asJson(s) } });
  if (s.floors.length) await tx.lotFloor.createMany({ data: s.floors.map(f => ({ lotId, version, id: f.id })) });
  if (s.zones.length) await tx.lotZone.createMany({ data: s.zones.map(z => ({ lotId, version, id: z.id, floorId: z.floorId })) });
  if (s.entrances.length) await tx.lotEntrance.createMany({ data: s.entrances.map(e => ({ lotId, version, id: e.id, floorId: e.floorId, zoneId: e.zoneId })) });
  if (s.ramps.length) await tx.lotRamp.createMany({ data: s.ramps.map(r => ({ lotId, version, id: r.id, fromFloorId: r.fromFloorId, toFloorId: r.toFloorId, fromZoneId: r.fromZoneId, toZoneId: r.toZoneId })) });
  if (s.parkingSpaces?.length) await tx.parkingSpace.createMany({ data: s.parkingSpaces.map(p => ({ lotId, version, id: p.id, floorId: p.floorId, zoneId: p.zoneId, label: p.label, type: p.type, active: p.active })) });
  if (s.pillars?.length) await tx.lotPillar.createMany({ data: s.pillars.map(p => ({ lotId, version, id: p.id, floorId: p.floorId, zoneId: p.zoneId })) });
  return revision;
}
