import {Inject,Injectable} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {DatabaseService} from '../database.service.js';
import {APP_CONFIG,type AppConfig} from '../config.js';
import {ApiError} from '../api-error.js';
export const REWARD_NOTIFICATIONS=Symbol('REWARD_NOTIFICATIONS');
export interface RewardNotificationProvider {send(notificationId:string):Promise<{deliveryId:string;source:'SANDBOX_MAILBOX';realDelivered:false}>;}
@Injectable()
export class SandboxRewardNotifications implements RewardNotificationProvider {
 constructor(private readonly db:DatabaseService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
 async send(notificationId:string){if(!this.config.devRewardsEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'REWARDS_POLICY_DISABLED');const row=await this.db.client.sandboxNotificationDelivery.upsert({where:{notificationId},create:{notificationId,deliveryId:randomUUID()},update:{}});return {deliveryId:row.deliveryId,source:'SANDBOX_MAILBOX' as const,realDelivered:false as const};}
}
