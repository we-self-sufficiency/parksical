import { randomUUID,createHash } from 'node:crypto';
import { Inject,Injectable } from '@nestjs/common';
import { APP_CONFIG,type AppConfig } from '../config.js';
import { ApiError } from '../api-error.js';
import { AuthService,type Principal } from '../auth/auth.service.js';
import { Prisma,type ParkedLocation } from '../generated/prisma/client.js';
import { asJson } from '../lots/store.js';
import { fingerprint } from '../vehicle/normalization.js';
import type { LocationCreateDto,LocationHistoryQuery,LocationPageQuery,LocationPatchDto,LocationPhotoDto,LocationVersionDto } from './dto.js';
import { PRIVATE_PHOTO_STORE,normalizePhoto,photoBytes,type PrivatePhotoStore } from './photos.js';
import { resolveSelection } from './selection.js';
import { cursorLocation,locationCursor } from './pagination.js';

type Tx=Prisma.TransactionClient;
const receipt=(r:ParkedLocation)=>({locationId:r.id,version:r.version,deleted:r.deletedAt!==null,accessEpoch:r.accessEpoch});
const state=(r:ParkedLocation)=>({selection:r.selection,note:r.note});
const photoView=(r:{id:string;mimeType:string;byteSize:number;width:number;height:number;createdAt:Date})=>({id:r.id,mimeType:r.mimeType,byteSize:r.byteSize,width:r.width,height:r.height,createdAt:r.createdAt.toISOString()});
@Injectable()
export class LocationService {
  constructor(private readonly auth:AuthService,@Inject(APP_CONFIG)private readonly config:AppConfig,@Inject(PRIVATE_PHOTO_STORE)private readonly photos:PrivatePhotoStore){}
  enabled(){if(!this.config.devLocationsEnabled || this.config.nodeEnv==='production')throw new ApiError(403,'LOCATIONS_POLICY_DISABLED');}
  private async work<T>(p:Principal,callback:(tx:Tx)=>Promise<T>){this.enabled();return this.auth.forUser(p,async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'locations:user:'+p.userId},0))`;return callback(tx);
  });}
  private async owned(tx:Tx,p:Principal,id:string,allowDeleted=false){
    const r=await tx.parkedLocation.findFirst({where:{id,userId:p.userId}});
    if(!r || (!allowDeleted && r.deletedAt))throw new ApiError(404,'RESOURCE_NOT_FOUND');return r;
  }
  private async view(tx:Tx,r:ParkedLocation){
    return {id:r.id,clientRecordId:r.clientRecordId,lotId:r.lotId,source:r.source,vehicleSessionId:r.vehicleSessionId,original:r.original,selection:r.selection,confidence:r.confidence,distanceM:r.distanceM,note:r.note,userEdited:r.userEdited,occurredAt:r.occurredAt.toISOString(),receivedAt:r.receivedAt.toISOString(),updatedAt:r.updatedAt.toISOString(),version:r.version,accessEpoch:r.accessEpoch,
      photos:(await tx.locationPhoto.findMany({where:{locationId:r.id,deletedAt:null},orderBy:{id:'asc'}})).map(photoView)};
  }
  private async mutation(p:Principal,key:string|undefined,route:string,value:unknown,action:(tx:Tx)=>Promise<{row:ParkedLocation;body:unknown;replayed?:boolean}>,replayDelete=false){
    this.enabled();if(!key || !/^[A-Za-z0-9_.-]{1,64}$/.test(key))throw new ApiError(400,'INVALID_IDEMPOTENCY_KEY');
    const requestHash=fingerprint({route,value});
    return this.work(p,async tx=>{
      const old=await tx.locationMutation.findUnique({where:{userId_key:{userId:p.userId,key}}});
      if(old){
        if(old.requestHash!==requestHash)throw new ApiError(409,'IDEMPOTENCY_CONFLICT');
        const target=await this.owned(tx,p,old.locationId,true);
        if(target.deletedAt && !replayDelete)throw new ApiError(409,'RESOURCE_DELETED');
        return {body:old.response,replayed:true};
      }
      const result=await action(tx),body=asJson(result.body);
      await tx.locationMutation.create({data:{userId:p.userId,key,locationId:result.row.id,requestHash,response:body}});
      return {body,replayed:result.replayed??false};
    });
  }
  private async version(tx:Tx,r:ParkedLocation,expected:number){
    if(r.version!==expected)throw new ApiError(409,'VERSION_CONFLICT');
    if(r.version>=2147483647)throw new ApiError(409,'VERSION_EXHAUSTED');
    if(await tx.locationChange.count({where:{locationId:r.id}})>=200)throw new ApiError(409,'LOCATION_HISTORY_LIMIT');
  }
  private async change(tx:Tx,p:Principal,r:ParkedLocation,kind:string,before?:ReturnType<typeof state>){
    await tx.locationChange.create({data:{locationId:r.id,version:r.version,kind,actorKind:p.kind,before:before?asJson(before):Prisma.DbNull,after:asJson(state(r))}});
  }
  async create(p:Principal,key:string|undefined,dto:LocationCreateDto){
    const value={...dto,occurredAt:new Date(dto.occurredAt).toISOString(),vehicleSessionId:dto.vehicleSessionId??null,note:dto.note??null};
    return this.mutation(p,key,'create',value,async tx=>{
      const old=await tx.parkedLocation.findUnique({where:{userId_clientRecordId:{userId:p.userId,clientRecordId:dto.clientRecordId}}});
      const creationHash=fingerprint(value);
      if(old){if(old.deletedAt)throw new ApiError(409,'RESOURCE_DELETED');if(old.creationHash!==creationHash)throw new ApiError(409,'RECORD_CONFLICT');return {row:old,body:{locationId:old.id,version:1,deleted:false,accessEpoch:1},replayed:true};}
      const time=new Date(dto.occurredAt);
      if(time.getUTCFullYear()<2000 || time.getTime()>Date.now()+300000)throw new ApiError(422,'INVALID_LOCATION_TIME');
      if(await tx.parkedLocation.count({where:{userId:p.userId,deletedAt:null}})>=1000)throw new ApiError(409,'LOCATION_COUNT_LIMIT');
      if(dto.vehicleSessionId){
        if(p.kind!=='VEHICLE')throw new ApiError(403,'VEHICLE_SESSION_REQUIRED');
        const session=await tx.vehicleSession.findFirst({where:{id:dto.vehicleSessionId,userId:p.userId,installationId:p.installationId!,reportedSource:'SYNTHETIC'}});
        if(!session)throw new ApiError(404,'RESOURCE_NOT_FOUND');
      }
      const selection=await resolveSelection(tx,dto.lotId,dto);
      const row=await tx.parkedLocation.create({data:{id:randomUUID(),userId:p.userId,clientRecordId:dto.clientRecordId,creationHash,lotId:dto.lotId,structureVersion:dto.structureVersion,floorId:dto.floorId,zoneId:dto.zoneId,parkingSpaceId:dto.parkingSpaceId,vehicleSessionId:dto.vehicleSessionId??null,source:'SYNTHETIC',original:asJson({...selection,confidence:dto.confidence,distanceM:dto.distanceM}),selection:asJson(selection),confidence:dto.confidence,distanceM:dto.distanceM,note:dto.note??null,occurredAt:time}});
      await this.change(tx,p,row,'CREATED');return {row,body:receipt(row)};
    });
  }
  async get(p:Principal,id:string){return this.work(p,async tx=>this.view(tx,await this.owned(tx,p,id)));}
  async current(p:Principal){return this.work(p,async tx=>{const row=await tx.parkedLocation.findFirst({where:{userId:p.userId,deletedAt:null},orderBy:[{occurredAt:'desc'},{id:'desc'}]});return {location:row?await this.view(tx,row):null};});}
  async list(p:Principal,q:LocationPageQuery){return this.work(p,async tx=>{
    const limit=q.limit??20;
    const anchor=q.cursor?await tx.parkedLocation.findFirst({where:{id:cursorLocation(p.userId,limit,q.cursor),userId:p.userId}}):null;
    if(q.cursor && !anchor)throw new ApiError(400,'INVALID_LOCATION_CURSOR');
    const rows=await tx.parkedLocation.findMany({where:{userId:p.userId,deletedAt:null,...(anchor?{OR:[{occurredAt:{lt:anchor.occurredAt}},{occurredAt:anchor.occurredAt,id:{lt:anchor.id}}]}:{})},orderBy:[{occurredAt:'desc'},{id:'desc'}],take:limit+1});
    return {items:await Promise.all(rows.slice(0,limit).map(r=>this.view(tx,r))),nextCursor:rows.length>limit?locationCursor(p.userId,limit,rows[limit-1]!.id):null};
  });}
  async history(p:Principal,id:string,q:LocationHistoryQuery){return this.work(p,async tx=>{
    await this.owned(tx,p,id);const limit=q.limit??20;
    const rows=await tx.locationChange.findMany({where:{locationId:id,...(q.beforeVersion?{version:{lt:q.beforeVersion}}:{})},orderBy:{version:'desc'},take:limit+1});
    return {items:rows.slice(0,limit).map(r=>({version:r.version,kind:r.kind,before:r.before,after:r.after,actorKind:r.actorKind,createdAt:r.createdAt.toISOString()})),nextBeforeVersion:rows.length>limit?rows[limit-1]!.version:null};
  });}
  async patch(p:Principal,id:string,key:string|undefined,dto:LocationPatchDto){
    return this.mutation(p,key,'patch:'+id,dto,async tx=>{
      const row=await this.owned(tx,p,id);await this.version(tx,row,dto.expectedVersion);
      const fields=['structureVersion','floorId','zoneId','parkingSpaceId','note'] as const;
      if(!fields.some(k=>dto[k]!==undefined))throw new ApiError(400,'EMPTY_LOCATION_PATCH');
      const selectionChanged=fields.slice(0,4).some(k=>dto[k]!==undefined);
      const input={structureVersion:dto.structureVersion===undefined?row.structureVersion:dto.structureVersion,floorId:dto.floorId===undefined?row.floorId:dto.floorId,zoneId:dto.zoneId===undefined?row.zoneId:dto.zoneId,parkingSpaceId:dto.parkingSpaceId===undefined?row.parkingSpaceId:dto.parkingSpaceId};
      const selection=selectionChanged?await resolveSelection(tx,row.lotId,input):row.selection;
      const updated=await tx.parkedLocation.update({where:{id},data:{...input,selection:asJson(selection),note:dto.note===undefined?row.note:dto.note,userEdited:row.userEdited||selectionChanged,version:{increment:1}}});
      await this.change(tx,p,updated,'CORRECTED',state(row));return {row:updated,body:receipt(updated)};
    });
  }
  async remove(p:Principal,id:string,key:string|undefined,dto:LocationVersionDto){return this.mutation(p,key,'delete:'+id,dto,async tx=>{
    const row=await this.owned(tx,p,id);if(row.version!==dto.expectedVersion)throw new ApiError(409,'VERSION_CONFLICT');
    const ids=(await tx.locationPhoto.findMany({where:{locationId:id},select:{id:true}})).map(x=>x.id);
    await this.photos.remove(tx,ids);await tx.locationPhoto.deleteMany({where:{locationId:id}});await tx.locationChange.deleteMany({where:{locationId:id}});
    const updated=await tx.parkedLocation.update({where:{id},data:{deletedAt:new Date(),note:null,original:asJson({}),selection:asJson({}),structureVersion:null,floorId:null,zoneId:null,parkingSpaceId:null,vehicleSessionId:null,confidence:'UNKNOWN',distanceM:null,userEdited:false,version:{increment:1},accessEpoch:{increment:1}}});
    return {row:updated,body:receipt(updated)};
  },true);}
  async addPhoto(p:Principal,id:string,key:string|undefined,dto:LocationPhotoDto){
    const bytes=photoBytes(dto.dataBase64),hash=createHash('sha256').update(bytes).digest('hex');
    return this.mutation(p,key,'photo-add:'+id,{expectedVersion:dto.expectedVersion,contentType:dto.contentType,hash},async tx=>{
      const row=await this.owned(tx,p,id);await this.version(tx,row,dto.expectedVersion);
      if(await tx.locationPhoto.count({where:{locationId:id,deletedAt:null}})>=5)throw new ApiError(409,'LOCATION_PHOTO_LIMIT');
      const normalized=await normalizePhoto(bytes,dto.contentType),photoId=randomUUID();
      await tx.locationPhoto.create({data:{id:photoId,locationId:id,byteSize:normalized.byteSize,width:normalized.width,height:normalized.height}});await this.photos.put(tx,photoId,normalized.bytes);
      const updated=await tx.parkedLocation.update({where:{id},data:{version:{increment:1}}});await this.change(tx,p,updated,'PHOTO_ADDED',state(row));
      return {row:updated,body:{...receipt(updated),photoId,photoDeleted:false}};
    });
  }
  async photo(p:Principal,id:string,photoId:string){return this.work(p,async tx=>{
    await this.owned(tx,p,id);const photo=await tx.locationPhoto.findFirst({where:{id:photoId,locationId:id,deletedAt:null}});if(!photo)throw new ApiError(404,'RESOURCE_NOT_FOUND');return this.photos.get(tx,photoId);
  });}
  async removePhoto(p:Principal,id:string,photoId:string,key:string|undefined,dto:LocationVersionDto){return this.mutation(p,key,'photo-delete:'+id+':'+photoId,dto,async tx=>{
    const row=await this.owned(tx,p,id);await this.version(tx,row,dto.expectedVersion);
    const photo=await tx.locationPhoto.findFirst({where:{id:photoId,locationId:id,deletedAt:null}});if(!photo)throw new ApiError(404,'RESOURCE_NOT_FOUND');
    await this.photos.remove(tx,[photoId]);await tx.locationPhoto.update({where:{id:photoId},data:{deletedAt:new Date()}});
    const updated=await tx.parkedLocation.update({where:{id},data:{version:{increment:1}}});await this.change(tx,p,updated,'PHOTO_DELETED',state(row));return {row:updated,body:{...receipt(updated),photoId,photoDeleted:true}};
  });}
}
