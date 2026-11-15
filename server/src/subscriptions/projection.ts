import {ApiError} from '../api-error.js';
import type {AppConfig} from '../config.js';
import type {Prisma} from '../generated/prisma/client.js';
import {asJson} from '../lots/store.js';
import type {SubscriptionClock} from './clock.js';
type Tx=Prisma.TransactionClient;
export async function paymentUserLock(tx:Tx,userId:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'payment-user:'+userId},0))`;}
export async function activeSubscriptionCycles(tx:Tx,userId:string,at:Date){return tx.subscriptionCycle.findMany({where:{subscription:{userId},startsAt:{lte:at},endsAt:{gt:at},paidAt:{lte:at},OR:[{revokedAt:null},{revokedAt:{gt:at}}]},orderBy:[{startsAt:'asc'},{id:'asc'}]});}
export async function requireSubscription(tx:Tx,userId:string,config:AppConfig,clock?:SubscriptionClock){
  if(!config.devSubscriptionsEnabled)return;
  await paymentUserLock(tx,userId);
  const now=clock?await clock.now(tx):new Date(Number((await tx.$queryRaw<{ms:bigint}[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms`)[0]!.ms));
  if(!(await activeSubscriptionCycles(tx,userId,now)).length)throw new ApiError(403,'SYNTHETIC_PASS_REQUIRED');
}
export async function subscriptionNeedsCompensation(tx:Tx,cycleId:string,now:Date){
  const cycle=await tx.subscriptionCycle.findUniqueOrThrow({where:{id:cycleId},include:{subscription:true}});
  return !!cycle.revokedAt || (!cycle.paidAt && (!cycle.subscription.renewalEnabled || now>=cycle.endsAt));
}
// Only the internal verified S-16 payment projector calls this. No client-supplied entitlement state.
export async function projectSubscriptionPayment(tx:Tx,cycleId:string,orderId:string,state:string,now:Date){
  const cycle=await tx.subscriptionCycle.findUniqueOrThrow({where:{id:cycleId}});
  const paidAt=state==='SUCCEEDED' && !cycle.paidAt?now:cycle.paidAt;
  const revokedAt=['CANCELLED','REFUND_PENDING','REFUNDED'].includes(state) && !cycle.revokedAt?now:cycle.revokedAt;
  if(paidAt!==cycle.paidAt || revokedAt!==cycle.revokedAt)await tx.subscriptionCycle.update({where:{id:cycleId},data:{paidAt,revokedAt}});
  const kind='PAYMENT_'+state;
  if(!await tx.subscriptionChange.findUnique({where:{cycleId_kind:{cycleId,kind}}}))await tx.subscriptionChange.create({data:{subscriptionId:cycle.subscriptionId,cycleId,kind,observedAt:now,details:asJson({orderId,state})}});
}
