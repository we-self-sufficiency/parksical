import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { ApiError } from '../api-error.js';
import type { Prisma } from '../generated/prisma/client.js';

export const MAX_PHOTO_BYTES=2*1024*1024;
export function photoBytes(value:string) {
  if(!value.length || value.length%4!==0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new ApiError(400,'INVALID_IMAGE_ENCODING');
  const bytes=Buffer.from(value,'base64');
  if(bytes.length>MAX_PHOTO_BYTES)throw new ApiError(413,'IMAGE_TOO_LARGE');
  if(bytes.toString('base64')!==value)throw new ApiError(400,'INVALID_IMAGE_ENCODING');
  return bytes;
}
let processing=0;
export async function normalizePhoto(bytes:Buffer,contentType:string) {
  if(processing>=2)throw new ApiError(429,'IMAGE_PROCESSING_BUSY',1);
  processing++;
  try{
    const jpeg=bytes.subarray(0,3).equals(Buffer.from([255,216,255])),png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if((contentType==='image/jpeg' && !jpeg) || (contentType==='image/png' && !png) || !['image/jpeg','image/png'].includes(contentType))throw new ApiError(422,'INVALID_IMAGE');
    if(png){for(let i=8;i+12<=bytes.length;){const length=bytes.readUInt32BE(i);if(length>bytes.length-i-12)throw new ApiError(422,'INVALID_IMAGE');if(bytes.toString('ascii',i+4,i+8)==='acTL')throw new ApiError(422,'INVALID_IMAGE');i+=12+length;}}
    const image=sharp(bytes,{limitInputPixels:12000000,failOn:'warning',animated:false});
    const meta=await image.metadata();
    if(!['jpeg','png'].includes(meta.format??'') || 'image/'+(meta.format==='jpeg'?'jpeg':'png')!==contentType || (meta.pages??1)>1)throw new ApiError(422,'INVALID_IMAGE');
    // Re-encode decoded pixels; default sharp output strips EXIF/GPS/XMP/ICC metadata.
    const result=await image.rotate().flatten({background:'#ffffff'}).resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:85}).toBuffer({resolveWithObject:true});
    if(result.data.length>MAX_PHOTO_BYTES)throw new ApiError(413,'IMAGE_TOO_LARGE');
    return {bytes:result.data,width:result.info.width,height:result.info.height,byteSize:result.data.length};
  }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(422,'INVALID_IMAGE');}finally{processing--;}
}
export const PRIVATE_PHOTO_STORE=Symbol('PRIVATE_PHOTO_STORE');
export interface PrivatePhotoStore {
  // Transactional development adapter. A remote provider needs an explicit staged-object/GC design.
  put(tx:Prisma.TransactionClient,id:string,bytes:Buffer):Promise<void>;
  get(tx:Prisma.TransactionClient,id:string):Promise<Buffer>;
  remove(tx:Prisma.TransactionClient,ids:string[]):Promise<void>;
}
@Injectable()
export class DatabasePhotoStore implements PrivatePhotoStore {
  async put(tx:Prisma.TransactionClient,id:string,bytes:Buffer){await tx.privatePhotoBlob.create({data:{photoId:id,bytes:Uint8Array.from(bytes)}});}
  async get(tx:Prisma.TransactionClient,id:string){const blob=await tx.privatePhotoBlob.findUnique({where:{photoId:id}});if(!blob)throw new ApiError(404,'RESOURCE_NOT_FOUND');return Buffer.from(blob.bytes);}
  async remove(tx:Prisma.TransactionClient,ids:string[]){await tx.privatePhotoBlob.deleteMany({where:{photoId:{in:ids}}});}
}
