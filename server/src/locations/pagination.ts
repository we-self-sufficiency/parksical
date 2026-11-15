import { createHash } from 'node:crypto';
import { ApiError } from '../api-error.js';
const queryHash=(userId:string,limit:number)=>createHash('sha256').update(userId+':'+limit).digest('hex');
export function locationCursor(userId:string,limit:number,id:string){return Buffer.from(JSON.stringify({id,query:queryHash(userId,limit)})).toString('base64url');}
export function cursorLocation(userId:string,limit:number,cursor:string){
  try{
    if(!/^[A-Za-z0-9_-]{1,256}$/.test(cursor))throw Error();
    const v=JSON.parse(Buffer.from(cursor,'base64url').toString()) as {id:string;query:string};
    if(Object.keys(v).sort().join()!=='id,query' || v.query!==queryHash(userId,limit) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.id))throw Error();return v.id;
  }catch{throw new ApiError(400,'INVALID_LOCATION_CURSOR');}
}
