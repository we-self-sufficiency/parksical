import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { DatabaseService } from '../database.service.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { APP_CONFIG,type AppConfig } from '../config.js';
import { catalogDifficulty,difficultyContext } from './catalog-input.js';
import { reviewEvidence } from '../reviews/aggregation.js';
import type { DifficultyQueryDto } from './dto.js';

@Injectable()
export class DifficultyService {
  constructor(private readonly db: DatabaseService,@Inject(APP_CONFIG)private readonly config:AppConfig) {}
  async get(id: string, query: DifficultyQueryDto, defaultYear: number) {
    const context=difficultyContext(query,defaultYear);
    return this.db.client.$transaction(async tx=>{
      const lot=await tx.parkingLot.findUnique({where:{id}});
      if (!lot) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const current=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId:id,version:lot.currentVersion}}});
      if (!current.active) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const revision=query.lotVersion===undefined || query.lotVersion===lot.currentVersion ? current : await tx.lotRevision.findUnique({where:{lotId_version:{lotId:id,version:query.lotVersion}}});
      if (!revision || !revision.active) throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const snapshot=revision.snapshot as unknown as LotSnapshotDto;
      if (revision.source!=='SYNTHETIC' || snapshot.source!=='SYNTHETIC') throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
      const aggregate=this.config.devReviewsEnabled?await tx.reviewAggregate.findUnique({where:{lotId_lotVersion:{lotId:id,lotVersion:revision.version}}}):null;
      const evidence=reviewEvidence(this.config.devReviewsEnabled,aggregate);
      return {lotId:id,lotVersion:revision.version,currentLotVersion:lot.currentVersion,sourceUpdatedAt:revision.sourceUpdatedAt.toISOString(),...catalogDifficulty(snapshot,context,evidence.factor),reviewAggregation:evidence.metadata};
    },{isolationLevel:'RepeatableRead'});
  }
}
