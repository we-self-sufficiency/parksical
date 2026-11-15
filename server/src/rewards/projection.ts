import {ApiError} from '../api-error.js';
import type {Prisma} from '../generated/prisma/client.js';
export async function requireValidRewardSource(tx:Prisma.TransactionClient,runId:string,lock=false){
 if(lock)await tx.$queryRaw`SELECT "runId" FROM "RankingRecord" WHERE "runId"=${runId}::uuid FOR SHARE`;
 const record=await tx.rankingRecord.findUnique({where:{runId}});
 if(!record || record.deletedAt || record.invalidatedAt)throw new ApiError(409,'COUPON_SOURCE_INVALIDATED');
}
