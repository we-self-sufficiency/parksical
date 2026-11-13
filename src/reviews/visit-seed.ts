import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { readConfig } from '../config.js';

export async function provisionSyntheticVisit(db:PrismaClient,userId:string,lotId:string,lotVersion:number,env:NodeJS.ProcessEnv) {
  if(!['development','test'].includes(env.NODE_ENV??'') || env.ALLOW_SYNTHETIC_REVIEW_VISIT!=='true' || env.DEV_REVIEWS_ENABLED!=='true')throw Error('SYNTHETIC_VISIT_DISABLED');
  return db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:'+lotId},0))`;
    const user=await tx.authIdentity.findFirst({where:{userId,provider:'DEV'}}),lot=await tx.parkingLot.findUnique({where:{id:lotId}});
    const revision=await tx.lotRevision.findUnique({where:{lotId_version:{lotId,version:lotVersion}}});
    if(!user || !lot || lot.currentVersion!==lotVersion || !revision?.active || revision.source!=='SYNTHETIC')throw Error('INVALID_SYNTHETIC_VISIT_REFERENCE');
    return tx.reviewVisit.upsert({where:{userId_lotId_lotVersion:{userId,lotId,lotVersion}},create:{id:randomUUID(),userId,lotId,lotVersion,source:'SYNTHETIC'},update:{}});
  });
}
async function main(){
  const config=readConfig();if(!config.devReviewsEnabled)throw Error('SYNTHETIC_VISIT_DISABLED');
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:config.databaseUrl})});
  try{
    const userId=process.env.SYNTHETIC_REVIEW_USER_ID,lotId=process.env.SYNTHETIC_REVIEW_LOT_ID??'66666666-6666-4666-8666-666666666666',version=Number(process.env.SYNTHETIC_REVIEW_LOT_VERSION??'1');
    if(!userId || !/^[0-9a-f-]{36}$/i.test(userId) || !/^[0-9a-f-]{36}$/i.test(lotId) || !Number.isInteger(version) || version<1)throw Error('Invalid synthetic visit arguments');
    const row=await provisionSyntheticVisit(db,userId,lotId,version,process.env);
    console.log(JSON.stringify({visitId:row.id,lotId:row.lotId,lotVersion:row.lotVersion,source:row.source}));
  }finally{await db.$disconnect();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)await main();
