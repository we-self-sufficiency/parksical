import { createHash } from 'node:crypto';
import { ApiError } from '../api-error.js';
import type { LotSearchQuery } from './search.dto.js';

export const EARTH_RADIUS_M=6371008.8;
export const MAX_CANDIDATES=1000;
export const radians=(degrees:number)=>degrees*Math.PI/180;
export function distanceMetres(lat1:number,lon1:number,lat2:number,lon2:number) {
  const a=Math.sin(radians(lat2-lat1)/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(radians(lon2-lon1)/2)**2;
  return 2*EARTH_RADIUS_M*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a))));
}
export function searchBounds(q:LotSearchQuery) {
  const values=[q.south,q.north,q.west,q.east],present=values.filter(v=>v!==undefined).length;
  if(q.lotVersion!==undefined)throw new ApiError(400,'SEARCH_VERSION_NOT_SUPPORTED');
  if(present) {
    if(present!==4 || q.radiusM!==undefined || q.south!>=q.north! || q.west!>=q.east! ||
      q.north!-q.south!>1 || q.east!-q.west!>1 || distanceMetres(q.south!,q.west!,q.north!,q.east!)>40000)throw new ApiError(400,'INVALID_SEARCH_BOUNDS');
    return {mode:'BOUNDS' as const,south:q.south!,north:q.north!,west:q.west!,east:q.east!,radiusM:null};
  }
  const radius=q.radiusM??3000,angular=radius/EARTH_RADIUS_M,lat=radians(q.latitude);
  const south=Math.max(-90,q.latitude-angular*180/Math.PI),north=Math.min(90,q.latitude+angular*180/Math.PI);
  const delta=south===-90 || north===90 ? 180 : Math.asin(Math.min(1,Math.sin(angular)/Math.cos(lat)))*180/Math.PI;
  const wrap=(x:number)=>(x+540)%360-180;
  return {mode:'RADIUS' as const,south,north,west:delta===180?-180:wrap(q.longitude-delta),east:delta===180?180:wrap(q.longitude+delta),radiusM:radius};
}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function queryFingerprint(q:LotSearchQuery,year:number) {
  return hash({latitude:q.latitude,longitude:q.longitude,bounds:searchBounds(q),limit:q.limit??20,sort:q.sort??'DISTANCE',ownership:q.ownership??null,partnered:q.partnered??null,discountCode:q.discountCode??null,vehicleStatus:q.vehicleStatus??null,vehicleLengthMm:q.vehicleLengthMm??null,vehicleWidthMm:q.vehicleWidthMm??null,asOfYear:year,ruleVersion:q.ruleVersion??'difficulty-v1'});
}
export function pageItems<T extends {id:string;version:number;distanceM:number;difficulty:{unroundedScore:number|null}}>(items:T[],q:LotSearchQuery,year:number) {
  items.sort((a,b)=>{
    const av=a.difficulty.unroundedScore,bv=b.difficulty.unroundedScore;
    if(q.sort==='EASIEST' && av!==bv) {
      if(av===null)return 1;if(bv===null)return -1;
      return av-bv;
    }
    return a.distanceM-b.distanceM || (a.id<b.id?-1:a.id>b.id?1:0);
  });
  const query=queryFingerprint(q,year),catalog=hash(items.map(x=>[x.id,x.version]));let offset=0;
  if(q.cursor!==undefined) {
    let cursor: {query:string;catalog:string;offset:number};
    try {
      if(!/^[A-Za-z0-9_-]{1,512}$/.test(q.cursor))throw Error();
      cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8')) as typeof cursor;
      if(!cursor || Object.keys(cursor).sort().join()!=='catalog,offset,query' || cursor.query!==query || !Number.isInteger(cursor.offset) || cursor.offset<=0 || cursor.offset>MAX_CANDIDATES || cursor.offset%(q.limit??20)!==0)throw Error();
    }catch{throw new ApiError(400,'INVALID_SEARCH_CURSOR');}
    if(cursor.catalog!==catalog)throw new ApiError(409,'SEARCH_CHANGED');
    offset=cursor.offset;
    if(offset>=items.length)throw new ApiError(400,'INVALID_SEARCH_CURSOR');
  }
  const limit=q.limit??20,next=offset+limit;
  return {items:items.slice(offset,next),nextCursor:next<items.length?Buffer.from(JSON.stringify({query,catalog,offset:next})).toString('base64url'):null};
}
