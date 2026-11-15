import { ApiError } from '../api-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import type { LocationSelectionDto } from './dto.js';

export async function resolveSelection(tx:Prisma.TransactionClient,lotId:string,input:LocationSelectionDto) {
  const lot=await tx.parkingLot.findUnique({where:{id:lotId}});
  if(!lot)throw new ApiError(404,'RESOURCE_NOT_FOUND');
  const {structureVersion,floorId,zoneId,parkingSpaceId}=input;
  if((structureVersion===null && [floorId,zoneId,parkingSpaceId].some(v=>v!==null)) || (floorId===null && (zoneId!==null || parkingSpaceId!==null)) || (parkingSpaceId!==null && zoneId===null))throw new ApiError(422,'INVALID_LOCATION_REFERENCE');
  const revision=await tx.lotRevision.findUnique({where:{lotId_version:{lotId,version:structureVersion??lot.currentVersion}}});
  if(!revision)throw new ApiError(422,'INVALID_LOCATION_REFERENCE');
  if(revision.source!=='SYNTHETIC')throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
  if(structureVersion===null)return {structureVersion,floorId,zoneId,parkingSpaceId,floorLabel:null,zoneLabel:null,parkingSpace:null,structureStatus:'UNRESOLVED',structureActive:null};
  const snapshot=revision.snapshot as unknown as LotSnapshotDto;
  const floor=floorId===null?null:snapshot.floors.find(f=>f.id===floorId);
  const zone=zoneId===null?null:snapshot.zones.find(z=>z.id===zoneId && z.floorId===floorId);
  if((floorId!==null && !floor) || (zoneId!==null && !zone))throw new ApiError(422,'INVALID_LOCATION_REFERENCE');
  const space=parkingSpaceId===null?null:await tx.parkingSpace.findUnique({where:{lotId_version_id:{lotId,version:structureVersion,id:parkingSpaceId}}});
  if(parkingSpaceId!==null && (!space || space.floorId!==floorId || space.zoneId!==zoneId))throw new ApiError(422,'INVALID_LOCATION_REFERENCE');
  if(space && !space.active)throw new ApiError(422,'PARKING_SPACE_INACTIVE');
  return {structureVersion,floorId,zoneId,parkingSpaceId,floorLabel:floor?.label??null,zoneLabel:zone?.label??null,parkingSpace:parkingSpaceId===null?null:snapshot.parkingSpaces?.find(s=>s.id===parkingSpaceId)??null,structureStatus:revision.structureStatus,structureActive:revision.active};
}
