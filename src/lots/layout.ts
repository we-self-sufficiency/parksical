import type { ParkingSpaceDto, PillarDto, PointDto } from './dto.js';

const EPS = 1e-8;
const cross = (a: PointDto, b: PointDto) => a.x * b.y - a.y * b.x;
const sub = (a: PointDto, b: PointDto) => ({ x: a.x - b.x, y: a.y - b.y });
function rectangle(center: PointDto, widthMm: number, depthMm: number, rotation: number): PointDto[] {
  const theta = rotation * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
    const dx = x! * widthMm / 2000, dy = y! * depthMm / 2000;
    return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
  });
}
export function spaceFootprint(p: ParkingSpaceDto) {
  return p.center !== null && p.widthMm !== null && p.lengthMm !== null && p.headingDegrees !== null
    ? rectangle(p.center, p.widthMm, p.lengthMm, p.headingDegrees - 90) : null;
}
export function pillarFootprint(p: PillarDto) {
  return p.center !== null && p.widthMm !== null && p.depthMm !== null && p.rotationDegrees !== null
    ? rectangle(p.center, p.widthMm, p.depthMm, p.rotationDegrees) : null;
}
function inside(p: PointDto, polygon: PointDto[]) {
  let result = false;
  for (let i = 0; i < polygon.length - 1; i++) {
    const a = polygon[i]!, b = polygon[i + 1]!;
    if (Math.abs(cross(sub(b,a),sub(p,a))) <= EPS && p.x >= Math.min(a.x,b.x)-EPS && p.x <= Math.max(a.x,b.x)+EPS && p.y >= Math.min(a.y,b.y)-EPS && p.y <= Math.max(a.y,b.y)+EPS) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) result = !result;
  }
  return result;
}
// Split rectangle edges at every boundary crossing. Corner-only checks miss concave notches.
export function fitsZone(rect: PointDto[], polygon: PointDto[]) {
  if (rect.some(p => !inside(p, polygon))) return false;
  for (let i = 0; i < rect.length; i++) {
    const a = rect[i]!, b = rect[(i+1)%rect.length]!, v = sub(b,a), ts = [0,1];
    for (let j = 0; j < polygon.length-1; j++) {
      const c = polygon[j]!, d = polygon[j+1]!, u = sub(d,c), delta = sub(c,a), denominator = cross(v,u);
      if (Math.abs(denominator) > EPS) {
        const t = cross(delta,u)/denominator, q = cross(delta,v)/denominator;
        if (t > 0 && t < 1 && q >= -EPS && q <= 1+EPS) ts.push(t);
      } else if (Math.abs(cross(delta,v)) <= EPS) {
        for (const p of [c,d]) {
          const t = Math.abs(v.x) > Math.abs(v.y) ? (p.x-a.x)/v.x : (p.y-a.y)/v.y;
          if (t > 0 && t < 1) ts.push(t);
        }
      }
    }
    ts.sort((x,y)=>x-y);
    for (let j=1;j<ts.length;j++) {
      const t=(ts[j-1]!+ts[j]!)/2;
      if (!inside({x:a.x+v.x*t,y:a.y+v.y*t},polygon)) return false;
    }
  }
  return true;
}
// Separating-axis test for the two derived rectangular footprints. Boundary touching is allowed.
export function footprintsOverlap(a: PointDto[], b: PointDto[]) {
  for (const poly of [a,b]) for (let i=0;i<poly.length;i++) {
    const edge=sub(poly[(i+1)%poly.length]!,poly[i]!), axis={x:-edge.y,y:edge.x};
    const project=(p: PointDto)=>p.x*axis.x+p.y*axis.y;
    const pa=a.map(project),pb=b.map(project);
    if (Math.max(...pa) <= Math.min(...pb)+EPS || Math.max(...pb) <= Math.min(...pa)+EPS) return false;
  }
  return true;
}
