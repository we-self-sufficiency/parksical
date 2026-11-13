import { ApiError } from '../api-error.js';
import type { LotSnapshotDto, PointDto } from './dto.js';

const fail = () => { throw new ApiError(422, 'INVALID_LOT_STRUCTURE'); };
const same = (a: PointDto, b: PointDto) => a.x === b.x && a.y === b.y;
const cross = (a: PointDto, b: PointDto, c: PointDto) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const on = (a: PointDto, b: PointDto, c: PointDto) => Math.abs(cross(a, b, c)) < 1e-9 && c.x >= Math.min(a.x, b.x) && c.x <= Math.max(a.x, b.x) && c.y >= Math.min(a.y, b.y) && c.y <= Math.max(a.y, b.y);
function intersects(a: PointDto, b: PointDto, c: PointDto, d: PointDto) {
  return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
}
export function validatePolygon(p: PointDto[]) {
  if (!same(p[0]!, p[p.length - 1]!)) fail();
  const n = p.length - 1;
  if (new Set(p.slice(0, n).map(v => `${v.x},${v.y}`)).size !== n) fail();
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i]!, b = p[i + 1]!;
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (intersects(a, b, p[j]!, p[j + 1]!)) fail();
    }
    // Adjacent edges may meet once, but may not fold back over each other.
    const c = p[(i + 2) % n]!;
    if (Math.abs(cross(a, b, c)) < 1e-9 && (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) <= 0) fail();
  }
  if (Math.abs(area) < 1e-6) fail();
}
export function validateSnapshot(s: LotSnapshotDto) {
  if (new Date(s.sourceUpdatedAt).getTime() > Date.now() + 300000) throw new ApiError(422, 'CLOCK_SKEW');
  const text = [s.name, s.address, s.sourceReference, s.rightsNote, ...s.tags, ...s.floors.map(f => f.label), ...s.zones.map(z => z.label), ...s.photos.flatMap(p => [p.caption, p.rightsNote])];
  if (text.some(v => !v.trim())) fail();
  if (s.photos.some(p => { const u = new URL(p.url); return u.username !== '' || u.password !== ''; })) fail();
  for (const rows of [s.floors, s.zones, s.entrances, s.ramps]) if (new Set(rows.map(r => r.id)).size !== rows.length) fail();
  const floors = new Map(s.floors.map(f => [f.id, f]));
  const zones = new Map(s.zones.map(z => [z.id, z]));
  const floor = (id: string) => { if (!floors.has(id)) fail(); };
  const zone = (id: string | null, floorId: string) => { if (id !== null && zones.get(id)?.floorId !== floorId) fail(); };
  for (const z of s.zones) { floor(z.floorId); if (z.polygon !== null) validatePolygon(z.polygon); }
  for (const e of s.entrances) { floor(e.floorId); zone(e.zoneId, e.floorId); }
  for (const r of s.ramps) { floor(r.fromFloorId); floor(r.toFloorId); zone(r.fromZoneId, r.fromFloorId); zone(r.toZoneId, r.toFloorId); if (r.fromFloorId === r.toFloorId) fail(); }
  if (s.structureStatus === 'COMPLETE' && (!s.floors.length || !s.zones.length || !s.entrances.length || s.floors.some(f => f.level === null) || s.zones.some(z => z.polygon === null) || s.entrances.some(e => e.point === null || e.direction === 'UNKNOWN') || s.ramps.some(r => r.direction === 'UNKNOWN'))) fail();
  if (s.operatingHours !== null) {
    const sorted = [...s.operatingHours].sort((a, b) => a.day - b.day || a.openMinute - b.openMinute);
    for (let i = 0; i < sorted.length; i++) {
      const h = sorted[i]!, previous = sorted[i - 1];
      if (h.openMinute >= h.closeMinute || (previous?.day === h.day && previous.closeMinute > h.openMinute)) fail();
    }
  }
}
