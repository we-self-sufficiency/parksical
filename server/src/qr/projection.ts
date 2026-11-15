import type { ParkedLocation } from '../generated/prisma/client.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import type { LocationSelectionDto } from '../locations/dto.js';
type Selection=LocationSelectionDto & {floorLabel:string|null;zoneLabel:string|null;parkingSpace:{label:string}|null};
export function phoneProjection(row:ParkedLocation,snapshot:LotSnapshotDto,expiresAt:Date){
  const selected=row.selection as unknown as Selection;
  const floor=selected.floorId;
  const shapes=floor===null?null:{
    unit:'m',
    zones:snapshot.zones.filter(z=>z.floorId===floor).map(z=>({polygon:z.polygon})),
    spaces:(snapshot.parkingSpaces??[]).filter(s=>s.floorId===floor).map(s=>({center:s.center,widthMm:s.widthMm,lengthMm:s.lengthMm,headingDegrees:s.headingDegrees,selected:s.id===selected.parkingSpaceId})),
    pillars:(snapshot.pillars??[]).filter(p=>p.floorId===floor).map(p=>({center:p.center,widthMm:p.widthMm,depthMm:p.depthMm,rotationDegrees:p.rotationDegrees})),
  };
  // No account/location/vehicle IDs, notes, photos, address, coordinates, or other-floor data.
  return {source:'SYNTHETIC',estimated:true,confidence:row.confidence,userEdited:row.userEdited,occurredAt:row.occurredAt.toISOString(),expiresAt:expiresAt.toISOString(),
    lotName:snapshot.name,floorLabel:selected.floorLabel,zoneLabel:selected.zoneLabel,parkingSpaceLabel:selected.parkingSpace?.label??null,map:shapes};
}
