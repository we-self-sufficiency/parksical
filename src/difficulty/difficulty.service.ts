import { Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { DatabaseService } from '../database.service.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { calculateDifficulty } from './calculator.js';
import { DifficultyInputError } from './rules.js';
import type { DifficultyQueryDto } from './dto.js';

@Injectable()
export class DifficultyService {
  constructor(private readonly db: DatabaseService) {}
  async get(id: string, query: DifficultyQueryDto, defaultYear: number) {
    const status=query.vehicleStatus ?? (query.vehicleLengthMm!==undefined || query.vehicleWidthMm!==undefined ? 'SUPPORTED':'UNKNOWN');
    const dims={lengthMm:query.vehicleLengthMm??null,widthMm:query.vehicleWidthMm??null};
    if ((status==='SUPPORTED' && (dims.lengthMm===null || dims.widthMm===null)) || (status!=='SUPPORTED' && (dims.lengthMm!==null || dims.widthMm!==null))) throw new ApiError(400,'INVALID_VEHICLE_DIMENSIONS');
    return this.db.client.$transaction(async tx=>{
      const lot=await tx.parkingLot.findUnique({where:{id}});
      if (!lot) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const current=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId:id,version:lot.currentVersion}}});
      if (!current.active) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const revision=query.lotVersion===undefined || query.lotVersion===lot.currentVersion ? current : await tx.lotRevision.findUnique({where:{lotId_version:{lotId:id,version:query.lotVersion}}});
      if (!revision || !revision.active) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const snapshot=revision.snapshot as unknown as LotSnapshotDto;
      if (revision.source!=='SYNTHETIC' || snapshot.source!=='SYNTHETIC') throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
      try {
        const result=calculateDifficulty({ruleVersion:query.ruleVersion,asOfYear:query.asOfYear??defaultYear,lotSource:'SYNTHETIC',builtYear:snapshot.builtYear,
          factors:{structure:{score:snapshot.factorScores.structure,source:'SYNTHETIC',sampleCount:null},
            review:{score:snapshot.factorScores.review,source:'SYNTHETIC',sampleCount:null},driving:{score:snapshot.factorScores.driving,source:'SYNTHETIC',sampleCount:null}},
          vehicle:{status,...dims}});
        return {lotId:id,lotVersion:revision.version,currentLotVersion:lot.currentVersion,sourceUpdatedAt:revision.sourceUpdatedAt.toISOString(),...result};
      } catch(error) {
        if (error instanceof DifficultyInputError) throw new ApiError(422,error.code);
        throw error;
      }
    },{isolationLevel:'RepeatableRead'});
  }
}
