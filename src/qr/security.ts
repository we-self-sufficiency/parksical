import { createHash,randomBytes,timingSafeEqual } from 'node:crypto';
import type { Request,Response } from 'express';
import { ApiError } from '../api-error.js';
export const QR_TTL_MS=24*60*60*1000;
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const secret=()=>randomBytes(32).toString('base64url');
export const validSecret=(value:unknown):value is string=>typeof value==='string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export const csrf=(value:string)=>hash('parksical-qr-csrf:'+value);
export function cookie(req:Request,name:string){
  const values=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'=')).map(x=>x.slice(name.length+1));
  if(values.length>1)throw new ApiError(400,'INVALID_REQUEST');
  return values[0];
}
export function cookieNames(origin:string){return origin.startsWith('https:')?{challenge:'__Host-parksical-qr-challenge',session:'__Host-parksical-qr'}:{challenge:'parksical-qr-challenge',session:'parksical-qr'};}
export function setCookie(res:Response,origin:string,name:string,value:string,maxAge:number){
  // __Host- requires Path=/ and no Domain; QR credentials are never accepted by account APIs.
  res.cookie(name,value,{httpOnly:true,sameSite:'strict',secure:origin.startsWith('https:'),path:'/',maxAge});
}
export function sameOrigin(req:Request,origin:string,required=true){
  const supplied=req.get('Origin'),site=req.get('Sec-Fetch-Site');
  if((required && supplied!==origin) || (supplied!==undefined && supplied!==origin) || (site!==undefined && site!=='same-origin'))throw new ApiError(403,'QR_ORIGIN_REJECTED');
}
export function checkCsrf(req:Request,origin:string){
  sameOrigin(req,origin);
  const seed=cookie(req,cookieNames(origin).challenge),supplied=req.get('X-CSRF-Token');
  if(!validSecret(seed) || !supplied || !/^[a-f0-9]{64}$/.test(supplied) || !timingSafeEqual(Buffer.from(csrf(seed)),Buffer.from(supplied)))throw new ApiError(403,'QR_CSRF_REJECTED');
  return seed;
}
