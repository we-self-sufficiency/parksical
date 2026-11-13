import { Inject,Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { APP_CONFIG,type AppConfig } from '../config.js';
import { reviewEvidence } from '../reviews/aggregation.js';
import { ApiError } from '../api-error.js';
import { DatabaseService } from '../database.service.js';
import { catalogDifficulty, difficultyContext } from '../difficulty/catalog-input.js';
import type { LotSnapshotDto } from './dto.js';
import type { LotDetailQuery, LotSearchQuery } from './search.dto.js';
import { EARTH_RADIUS_M, MAX_CANDIDATES, pageItems, searchBounds } from './search.js';

type Candidate={reviewSampleCount:number|null;reviewScoreSum:bigint|null;reviewAggregateVersion:number|null;reviewAggregateUpdatedAt:Date|null;reviewAggregateSource:string|null;id:string;code:string;version:number;name:string;latitude:number;longitude:number;ownership:string;parkingType:string;partnered:boolean;builtYear:number|null;sourceUpdatedAt:Date;structureStatus:string;distanceM:number;summary:Pick<LotSnapshotDto,'source'|'address'|'timezone'|'operatingHours'|'fees'|'tags'|'discounts'|'factorScores'>};
// Query is parameterized. Select only card fields, never full geometry/photos/history.
export function candidateQuery(q:LotSearchQuery) {
  const b=searchBounds(q);
  const longitude=b.west<=b.east?Prisma.sql`r.longitude BETWEEN ${b.west} AND ${b.east}`:Prisma.sql`(r.longitude>=${b.west} OR r.longitude<=${b.east})`;
  const distance=Prisma.sql`(2*${EARTH_RADIUS_M}::double precision*asin(sqrt(least(1.0,greatest(0.0,power(sin(radians(r.latitude-${q.latitude})/2),2)+cos(radians(${q.latitude}))*cos(radians(r.latitude))*power(sin(radians(r.longitude-${q.longitude})/2),2))))))`;
  return Prisma.sql`SELECT l.id,l.code,r.version,r.name,r.latitude,r.longitude,r.ownership,r."parkingType",r.partnered,r."builtYear",r."sourceUpdatedAt",r."structureStatus",${distance} AS "distanceM", a."sampleCount" AS "reviewSampleCount",a."scoreSum" AS "reviewScoreSum",a.version AS "reviewAggregateVersion",a."updatedAt" AS "reviewAggregateUpdatedAt",a.source AS "reviewAggregateSource",
    jsonb_build_object('source',r.snapshot->'source','address',r.snapshot->'address','timezone',r.snapshot->'timezone','operatingHours',r.snapshot->'operatingHours','fees',r.snapshot->'fees','tags',r.snapshot->'tags','discounts',r.snapshot->'discounts','factorScores',r.snapshot->'factorScores') AS summary
    FROM "LotRevision" r JOIN "ParkingLot" l ON l.id=r."lotId" AND l."currentVersion"=r.version LEFT JOIN "ReviewAggregate" a ON a."lotId"=r."lotId" AND a."lotVersion"=r.version
    WHERE r.active=true AND r.source='SYNTHETIC' AND r.latitude BETWEEN ${b.south} AND ${b.north} AND ${longitude}
    ${b.radiusM===null?Prisma.empty:Prisma.sql`AND ${distance}<=${b.radiusM}`}
    ${q.ownership===undefined?Prisma.empty:Prisma.sql`AND r.ownership=${q.ownership}`}
    ${q.partnered===undefined?Prisma.empty:Prisma.sql`AND r.partnered=${q.partnered}`}
    ${q.discountCode===undefined?Prisma.empty:Prisma.sql`AND r."discountCodes" @> ARRAY[${q.discountCode}]::text[]`}
    ORDER BY l.id LIMIT ${MAX_CANDIDATES+1}`;
}
const challenge={available:false as const,status:'NOT_CONFIGURED' as const};
function navigation(latitude:number,longitude:number) {
  return {latitude,longitude,coordinateSystem:'WGS84' as const,usable:false as const,reason:'SYNTHETIC_COORDINATE' as const};
}
@Injectable()
export class CatalogService {
  constructor(private readonly db:DatabaseService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
  async search(q:LotSearchQuery,defaultYear:number) {
    const context=difficultyContext(q,defaultYear),bounds=searchBounds(q);
    return this.db.client.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Candidate[]>(candidateQuery(q));
      if(rows.length>MAX_CANDIDATES)throw new ApiError(422,'SEARCH_TOO_BROAD');
      const items=rows.map(r=>{
        const evidence=reviewEvidence(this.config.devReviewsEnabled,r.reviewAggregateVersion===null?null:{sampleCount:r.reviewSampleCount!,scoreSum:r.reviewScoreSum!,version:r.reviewAggregateVersion,updatedAt:r.reviewAggregateUpdatedAt!,source:r.reviewAggregateSource!});
        const result=catalogDifficulty({...r.summary,builtYear:r.builtYear},context,evidence.factor);
        return {id:r.id,code:r.code,version:r.version,name:r.name,address:r.summary.address,latitude:r.latitude,longitude:r.longitude,ownership:r.ownership,parkingType:r.parkingType,partnered:r.partnered,builtYear:r.builtYear,source:'SYNTHETIC' as const,sourceUpdatedAt:r.sourceUpdatedAt.toISOString(),structureStatus:r.structureStatus,
          distanceM:r.distanceM,timezone:r.summary.timezone,operatingHours:r.summary.operatingHours,fees:r.summary.fees,tags:r.summary.tags,discounts:r.summary.discounts??null,
          difficulty:{reviewAggregation:evidence.metadata,status:result.status,score:result.score,unroundedScore:result.unroundedScore,baseScore:result.baseScore,ruleVersion:result.ruleVersion,asOfYear:result.asOfYear,vehicle:result.vehicle,coverage:result.coverage,caveats:result.caveats},navigation:navigation(r.latitude,r.longitude),challenge};
      });
      return {...pageItems(items,q,context.asOfYear),search:{mode:bounds.mode,origin:{latitude:q.latitude,longitude:q.longitude},bounds,distanceMethod:'HAVERSINE_SPHERE' as const,earthRadiusM:EARTH_RADIUS_M,sort:q.sort??'DISTANCE',asOfYear:context.asOfYear,ruleVersion:context.ruleVersion??'difficulty-v1',candidateLimit:MAX_CANDIDATES}};
    },{isolationLevel:'RepeatableRead'});
  }
  async detail(id:string,q:LotDetailQuery,defaultYear:number) {
    const context=difficultyContext(q,defaultYear);
    return this.db.client.$transaction(async tx=>{
      const lot=await tx.parkingLot.findUnique({where:{id}});
      if(!lot)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const current=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId:id,version:lot.currentVersion}}});
      if(!current.active)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const revision=q.lotVersion===undefined || q.lotVersion===current.version?current:await tx.lotRevision.findUnique({where:{lotId_version:{lotId:id,version:q.lotVersion}}});
      if(!revision || !revision.active)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      if(revision.source!=='SYNTHETIC')throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
      const snapshot=revision.snapshot as unknown as LotSnapshotDto;
      const aggregate=this.config.devReviewsEnabled?await tx.reviewAggregate.findUnique({where:{lotId_lotVersion:{lotId:id,lotVersion:revision.version}}}):null;
      const evidence=reviewEvidence(this.config.devReviewsEnabled,aggregate);
      return {id:lot.id,code:lot.code,version:revision.version,currentVersion:lot.currentVersion,sourceUpdatedAt:revision.sourceUpdatedAt.toISOString(),snapshot,
        discounts:snapshot.discounts??null,difficulty:{lotId:id,lotVersion:revision.version,currentLotVersion:lot.currentVersion,sourceUpdatedAt:revision.sourceUpdatedAt.toISOString(),...catalogDifficulty(snapshot,context,evidence.factor),reviewAggregation:evidence.metadata},navigation:navigation(snapshot.latitude,snapshot.longitude),challenge};
    },{isolationLevel:'RepeatableRead'});
  }
}
