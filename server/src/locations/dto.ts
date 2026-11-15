import { Transform } from 'class-transformer';
import { IsIn,IsInt,IsISO8601,IsNumber,IsString,IsUUID,Matches,Max,MaxLength,Min,MinLength,ValidateIf } from 'class-validator';
export class LocationSelectionDto {
  @ValidateIf(o=>o.structureVersion!==null) @IsInt() @Min(1) @Max(2147483647) structureVersion!:number|null;
  @ValidateIf(o=>o.floorId!==null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId!:string|null;
  @ValidateIf(o=>o.zoneId!==null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) zoneId!:string|null;
  @ValidateIf(o=>o.parkingSpaceId!==null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) parkingSpaceId!:string|null;
}
export class LocationCreateDto extends LocationSelectionDto {
  @Matches(/^[A-Za-z0-9_.-]{1,64}$/) clientRecordId!:string;
  @IsUUID() lotId!:string;
  @IsIn(['SYNTHETIC']) source!:'SYNTHETIC';
  @IsIn(['HIGH','MEDIUM','LOW','UNKNOWN']) confidence!:string;
  @ValidateIf(o=>o.distanceM!==null) @IsNumber({maxDecimalPlaces:3}) @Min(0) @Max(100000) distanceM!:number|null;
  @IsISO8601({strict:true}) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) occurredAt!:string;
  @ValidateIf(o=>o.vehicleSessionId!==undefined && o.vehicleSessionId!==null) @IsUUID() vehicleSessionId?:string|null;
  @ValidateIf(o=>o.note!==undefined && o.note!==null) @IsString() @MaxLength(1000) note?:string|null;
}
export class LocationVersionDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!:number;
}
export class LocationPatchDto extends LocationVersionDto {
  @ValidateIf(o=>o.structureVersion!==undefined && o.structureVersion!==null) @IsInt() @Min(1) @Max(2147483647) structureVersion?:number|null;
  @ValidateIf(o=>o.floorId!==undefined && o.floorId!==null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId?:string|null;
  @ValidateIf(o=>o.zoneId!==undefined && o.zoneId!==null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) zoneId?:string|null;
  @ValidateIf(o=>o.parkingSpaceId!==undefined && o.parkingSpaceId!==null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) parkingSpaceId?:string|null;
  @ValidateIf(o=>o.note!==undefined && o.note!==null) @IsString() @MaxLength(1000) note?:string|null;
}
const integer=()=>Transform(({value}:{value:unknown})=>typeof value==='string' && /^\d{1,10}$/.test(value)?Number(value):value);
export class LocationPageQuery {
  @ValidateIf(o=>o.limit!==undefined) @integer() @IsInt() @Min(1) @Max(50) limit?:number;
  @ValidateIf(o=>o.cursor!==undefined) @IsString() @MinLength(1) @MaxLength(256) cursor?:string;
}
export class LocationHistoryQuery {
  @ValidateIf(o=>o.limit!==undefined) @integer() @IsInt() @Min(1) @Max(50) limit?:number;
  @ValidateIf(o=>o.beforeVersion!==undefined) @integer() @IsInt() @Min(1) @Max(2147483647) beforeVersion?:number;
}
export class LocationPhotoDto extends LocationVersionDto {
  @IsIn(['image/jpeg','image/png']) contentType!:'image/jpeg'|'image/png';
  @IsString() @MaxLength(3145728) dataBase64!:string;
}
