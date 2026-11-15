import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import type {Principal} from '../auth/auth.service.js';
import {ApiError} from '../api-error.js';
import {asJson} from '../lots/store.js';
import type {RunPageQuery} from '../missions/dto.js';
import {cursorLocation,locationCursor} from '../locations/pagination.js';
import {RewardAccess} from './access.js';
import {RewardClock} from './clock.js';
import type {RewardBatchDto} from './dto.js';
import {REWARD_NOTIFICATIONS,type RewardNotificationProvider} from './notification-provider.js';
import {rewardBoundary} from './rules.js';
@Injectable()
export class RewardNotificationService {
 constructor(private readonly access:RewardAccess,private readonly clock:RewardClock,@Inject(REWARD_NOTIFICATIONS)private readonly provider:RewardNotificationProvider){}
 async dispatch(p:Principal,key:string|undefined,dto:RewardBatchDto){
  const stage=await this.access.admin(p,async tx=>{const cmd=await this.access.command(tx,p,key,'dispatch',dto);if(cmd.response)return {response:cmd.response,ids:[] as string[]};if(cmd.work)return {response:null,ids:cmd.work as string[]};
   const now=await this.clock.now(tx);await tx.rewardNotification.updateMany({where:{state:'PROCESSING',attempts:{gte:3},leaseUntil:{lte:now}},data:{state:'FAILED',leaseId:null,leaseUntil:null,lastError:'PROVIDER_UNAVAILABLE'}});const rows=await tx.rewardNotification.findMany({where:{attempts:{lt:3},OR:[{state:'PENDING',nextAttemptAt:{lte:now}},{state:'PROCESSING',leaseUntil:{lte:now}}]},orderBy:[{nextAttemptAt:'asc'},{id:'asc'}],take:dto.limit});const ids=rows.map(r=>r.id);await tx.rewardMutation.update({where:{userId_key:{userId:p.userId,key:key!}},data:{work:asJson(ids)}});return {response:null,ids};});
  if(stage.response)return {body:stage.response,replayed:true};
  for(const id of stage.ids){
   const lease=await this.access.admin(p,async tx=>{const now=await this.clock.now(tx),row=await tx.rewardNotification.findUniqueOrThrow({where:{id}});if(row.attempts>=3 || !(row.state==='PENDING' && row.nextAttemptAt<=now || row.state==='PROCESSING' && row.leaseUntil && row.leaseUntil<=now))return null;const leaseId=randomUUID();const won=await tx.rewardNotification.updateMany({where:{id,attempts:row.attempts,state:row.state},data:{state:'PROCESSING',attempts:{increment:1},leaseId,leaseUntil:new Date(now.getTime()+30000)}});return won.count?{leaseId,attempt:row.attempts+1}:null;});
   if(!lease)continue;let success=false;try{await this.provider.send(id);success=true;}catch{/* Only an allowlisted error code is persisted, never provider payload/secrets. */}
   await this.access.admin(p,async tx=>{const now=await this.clock.now(tx);await tx.rewardNotification.updateMany({where:{id,state:'PROCESSING',leaseId:lease.leaseId},data:success?{state:'DELIVERED',deliveredAt:now,leaseId:null,leaseUntil:null,lastError:null}:{state:lease.attempt>=3?'FAILED':'PENDING',nextAttemptAt:new Date(now.getTime()+(lease.attempt===1?60000:300000)),leaseId:null,leaseUntil:null,lastError:'PROVIDER_UNAVAILABLE'}});});
  }
  return this.access.admin(p,async tx=>{const cmd=await this.access.command(tx,p,key,'dispatch',dto);if(cmd.response)return {body:cmd.response,replayed:true};const states=await tx.rewardNotification.findMany({where:{id:{in:stage.ids}},select:{state:true}});return this.access.finish(tx,p,key!,{counts:{selected:stage.ids.length,delivered:states.filter(r=>r.state==='DELIVERED').length,pending:states.filter(r=>r.state==='PENDING'||r.state==='PROCESSING').length,failed:states.filter(r=>r.state==='FAILED').length},provider:'SANDBOX_MAILBOX',realDelivered:false,...rewardBoundary});});
 }
 async mine(p:Principal,q:RunPageQuery){return this.access.user(p,async tx=>{const limit=q.limit??20,binding=p.userId+':reward-notices',rows=await tx.rewardNotification.findMany({where:{coupon:{userId:p.userId}},orderBy:[{nextAttemptAt:'desc'},{id:'desc'}]}),anchor=q.cursor?cursorLocation(binding,limit,q.cursor):null,index=anchor?rows.findIndex(r=>r.id===anchor):-1;if(anchor && index<0)throw new ApiError(400,'INVALID_NOTIFICATION_CURSOR');const rest=rows.slice(index+1);return {items:rest.slice(0,limit).map(r=>({id:r.id,couponId:r.couponId,state:r.state,attempts:r.attempts,nextAttemptAt:r.nextAttemptAt.toISOString(),deliveredAt:r.deliveredAt?.toISOString()??null,provider:'SANDBOX_MAILBOX',realDelivered:false})),nextCursor:rest.length>limit?locationCursor(binding,limit,rest[limit-1]!.id):null,...rewardBoundary};});}
}
