import {Inject,Injectable} from '@nestjs/common';
import {ApiError} from '../api-error.js';
import {AuthService,type Principal} from '../auth/auth.service.js';
import {APP_CONFIG,type AppConfig} from '../config.js';
import type {Prisma} from '../generated/prisma/client.js';
import {asJson} from '../lots/store.js';
import {fingerprint} from '../vehicle/normalization.js';
import {paymentUserLock} from '../subscriptions/projection.js';
type Tx=Prisma.TransactionClient;
@Injectable()
export class RewardAccess {
 constructor(private readonly auth:AuthService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
 enabled(){if(!this.config.devRewardsEnabled || !this.config.devAuthEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'REWARDS_POLICY_DISABLED');}
 async user<T>(p:Principal,fn:(tx:Tx)=>Promise<T>){this.enabled();return this.auth.forUser(p,async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'reservation-user:'+p.userId},0))`;await paymentUserLock(tx,p.userId);return fn(tx);});}
 async admin<T>(p:Principal,fn:(tx:Tx)=>Promise<T>){this.enabled();return this.auth.forAdmin(p,async tx=>{await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'reward-admin:'+p.userId},0))`;return fn(tx);});}
 async command(tx:Tx,p:Principal,key:string|undefined,route:string,dto:unknown){
  if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');const where={userId_key:{userId:p.userId,key}},requestHash=fingerprint({route,dto}),old=await tx.rewardMutation.findUnique({where});
  if(old){if(old.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');return old;}
  return tx.rewardMutation.create({data:{userId:p.userId,key,requestHash}});
 }
 async finish(tx:Tx,p:Principal,key:string,body:unknown){const response=asJson(body);await tx.rewardMutation.update({where:{userId_key:{userId:p.userId,key}},data:{response}});return {body:response,replayed:false};}
 async mutate(p:Principal,key:string|undefined,route:string,dto:unknown,fn:(tx:Tx)=>Promise<unknown>,admin=false){const run=async(tx:Tx)=>{const cmd=await this.command(tx,p,key,route,dto);if(cmd.response)return {body:cmd.response,replayed:true};return this.finish(tx,p,key!,await fn(tx));};return admin?this.admin(p,run):this.user(p,run);}
}
