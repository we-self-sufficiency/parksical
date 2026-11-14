import { createHmac } from 'node:crypto';
import { Inject,Injectable } from '@nestjs/common';
import { APP_CONFIG,type AppConfig } from '../config.js';
import { DatabaseService } from '../database.service.js';
import { AuthService,type Principal } from '../auth/auth.service.js';
import { ApiError } from '../api-error.js';
import type { Prisma,QrAccessGrant } from '../generated/prisma/client.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { fingerprint } from '../vehicle/normalization.js';
import { QR_TTL_MS,hash,secret,validSecret } from './security.js';
import { phoneProjection } from './projection.js';
type Tx=Prisma.TransactionClient;
export function validGrant(grant:Pick<QrAccessGrant,'expiresAt'|'revokedAt'|'accessEpoch'>,location:{deletedAt:Date|null;accessEpoch:number},now=new Date()){
  return !grant.revokedAt && grant.expiresAt>now && !location.deletedAt && grant.accessEpoch===location.accessEpoch;
}
const keyValue=(value:string|undefined)=>{if(!value || !/^[A-Za-z0-9_.-]{1,64}$/.test(value))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');return value;};
@Injectable()
export class QrService {
  constructor(private readonly db:DatabaseService,private readonly auth:AuthService,@Inject(APP_CONFIG)private readonly config:AppConfig){}
  origin(){if(!this.config.devQrEnabled || !this.config.devLocationsEnabled || this.config.nodeEnv==='production' || !this.config.qrPublicOrigin)throw new ApiError(403,'QR_POLICY_DISABLED');return this.config.qrPublicOrigin;}
  private async lock(tx:Tx,userId:string){await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtextextended($1,0))','locations:user:'+userId);}
  async issue(p:Principal,locationId:string,version:number,key:string|undefined){
    const origin=this.origin(),issueKey=keyValue(key),requestHash=fingerprint({locationId,version});
    return this.auth.forUser(p,async tx=>{
      await this.lock(tx,p.userId);
      const row=await tx.parkedLocation.findFirst({where:{id:locationId,userId:p.userId,deletedAt:null}});
      if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      const old=await tx.qrAccessGrant.findUnique({where:{userId_issueKey:{userId:p.userId,issueKey}}});
      if(old)throw new ApiError(409,old.requestHash===requestHash?'QR_SECRET_ALREADY_ISSUED':'IDEMPOTENCY_CONFLICT');
      if(row.version!==version)throw new ApiError(409,'VERSION_CONFLICT');
      if(row.source!=='SYNTHETIC')throw new ApiError(403,'QR_POLICY_DISABLED');
      if(await tx.qrAccessGrant.count({where:{userId:p.userId}})>=1000)throw new ApiError(409,'QR_GRANT_LIMIT');
      const token=secret(),now=new Date(),expiresAt=new Date(now.getTime()+QR_TTL_MS);
      await tx.qrAccessGrant.updateMany({where:{locationId,revokedAt:null},data:{revokedAt:now}});
      const grant=await tx.qrAccessGrant.create({data:{userId:p.userId,locationId,issuerSessionId:p.sessionId,tokenHash:hash(token),issueKey,requestHash,accessEpoch:row.accessEpoch,createdAt:now,expiresAt}});
      return {grantId:grant.id,url:origin+'/p#'+token,expiresAt:expiresAt.toISOString(),policyStatus:'PROVISIONAL_D07'};
    });
  }
  async revoke(p:Principal,locationId:string,grantId:string,key:string|undefined){
    this.origin();keyValue(key);
    return this.auth.forUser(p,async tx=>{
      await this.lock(tx,p.userId);
      const grant=await tx.qrAccessGrant.findFirst({where:{id:grantId,locationId,userId:p.userId}});
      if(!grant)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      if(!grant.revokedAt)await tx.qrAccessGrant.update({where:{id:grantId},data:{revokedAt:new Date()}});
      return {grantId,revoked:true};
    });
  }
  private async delegated<T>(grant:QrAccessGrant,work:(tx:Tx,current:QrAccessGrant)=>Promise<T>){
    return this.auth.forDelegatedUser(grant.issuerSessionId,grant.userId,async tx=>{
      await this.lock(tx,grant.userId);
      const current=await tx.qrAccessGrant.findUnique({where:{id:grant.id},include:{location:true}});
      if(!current || !validGrant(current,current.location) || current.userId!==current.location.userId)throw new ApiError(410,'QR_UNAVAILABLE');
      return work(tx,current);
    });
  }
  async exchange(token:string,browserSeed:string,key:string|undefined){
    this.origin();const exchangeKey=keyValue(key);
    if(!validSecret(token))throw new ApiError(410,'QR_UNAVAILABLE');
    const grant=await this.db.client.qrAccessGrant.findUnique({where:{tokenHash:hash(token)}});
    if(!grant)throw new ApiError(410,'QR_UNAVAILABLE');
    const binding=fingerprint({seedHash:hash(browserSeed),key:exchangeKey});
    // Deterministic only for this token+browser proof+key: retry can restore the HttpOnly cookie.
    // DB persists only the derived credential's hash, never the token or cookie.
    const credential=createCredential(token,browserSeed,exchangeKey);
    return this.delegated(grant,async(tx,current)=>{
      const previous=await tx.qrPhoneSession.findUnique({where:{grantId:current.id}});
      if(current.consumedAt){
        if(current.exchangeHash!==binding || !previous || previous.revokedAt || previous.expiresAt<=new Date() || previous.secretHash!==hash(credential))throw new ApiError(409,'QR_ALREADY_EXCHANGED');
        return {credential,expiresAt:previous.expiresAt,replayed:true};
      }
      const now=new Date();if(current.expiresAt<=now)throw new ApiError(410,'QR_UNAVAILABLE');
      await tx.qrAccessGrant.update({where:{id:current.id},data:{consumedAt:now,exchangeHash:binding}});
      await tx.qrPhoneSession.create({data:{grantId:current.id,secretHash:hash(credential),createdAt:now,expiresAt:current.expiresAt}});
      return {credential,expiresAt:current.expiresAt,replayed:false};
    });
  }
  async location(credential:string|undefined){
    this.origin();if(!validSecret(credential))throw new ApiError(410,'QR_UNAVAILABLE');
    const session=await this.db.client.qrPhoneSession.findUnique({where:{secretHash:hash(credential)},include:{grant:true}});
    if(!session)throw new ApiError(410,'QR_UNAVAILABLE');
    return this.delegated(session.grant,async(tx,grant)=>{
      const active=await tx.qrPhoneSession.findUnique({where:{grantId:grant.id}});
      if(!active || active.revokedAt || active.expiresAt<=new Date() || active.secretHash!==hash(credential))throw new ApiError(410,'QR_UNAVAILABLE');
      const row=await tx.parkedLocation.findUniqueOrThrow({where:{id:grant.locationId}});
      const lot=await tx.parkingLot.findUniqueOrThrow({where:{id:row.lotId}});
      const revision=await tx.lotRevision.findUniqueOrThrow({where:{lotId_version:{lotId:row.lotId,version:row.structureVersion??lot.currentVersion}}});
      return phoneProjection(row,revision.snapshot as unknown as LotSnapshotDto,active.expiresAt);
    });
  }
  async logout(credential:string|undefined){
    this.origin();if(validSecret(credential))await this.db.client.qrPhoneSession.updateMany({where:{secretHash:hash(credential),revokedAt:null},data:{revokedAt:new Date()}});
  }
}
function createCredential(token:string,seed:string,key:string){return createHmac('sha256',token).update('parksical-qr-session:'+seed+':'+key).digest('base64url');}
