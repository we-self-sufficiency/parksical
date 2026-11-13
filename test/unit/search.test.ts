import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { LotSearchQuery } from '../../src/lots/search.dto.js';
import { distanceMetres, pageItems, searchBounds } from '../../src/lots/search.js';
import { ApiError } from '../../src/api-error.js';

const query=(extra:Partial<LotSearchQuery>={}):LotSearchQuery=>Object.assign(new LotSearchQuery(),{latitude:0,longitude:0,...extra});
test('search great-circle distances, conservative bounds, dateline and polar radius',()=>{
  assert.equal(distanceMetres(0,0,0,0),0);
  assert.ok(Math.abs(distanceMetres(0,0,0,1)-111195.08)<.1);
  assert.ok(Math.abs(distanceMetres(0,179.99,0,-179.99)-2223.9)<1);
  assert.equal(searchBounds(query()).radiusM,3000);
  const dateline=searchBounds(query({longitude:179.999}));assert.ok(dateline.west>dateline.east);
  const polar=searchBounds(query({latitude:90}));assert.equal(polar.west,-180);assert.equal(polar.east,180);
  for(const extra of [{south:0},{south:0,north:1,west:0,east:1},{south:0,north:.01,west:1,east:0},{south:0,north:.01,west:0,east:.01,radiusM:1},{lotVersion:1}])assert.throws(()=>searchBounds(query(extra)),ApiError);
  assert.equal(searchBounds(query({south:0,north:.01,west:0,east:.01})).mode,'BOUNDS');
});
test('strict query coercion rejects arrays, exponent, spaces, missing coordinates and unknown values',()=>{
  for(const extra of [{latitude:'1e1'},{longitude:' 0'},{longitude:['0','1']},{latitude:undefined},{radiusM:'20001'},{partnered:'1'},{limit:'51'},{vehicleLengthMm:'0x1000'}]){
    const dto=plainToInstance(LotSearchQuery,{latitude:'0',longitude:'0',...extra});assert.ok(validateSync(dto).length,JSON.stringify(extra));
  }
  const valid=plainToInstance(LotSearchQuery,{latitude:'-37.12',longitude:'180',partnered:'false',radiusM:'20000'});assert.equal(validateSync(valid).length,0);assert.equal(valid.partnered,false);
});
test('search ties, null-last difficulty, page completeness and stale/query-bound cursor',()=>{
  const items=[{id:'b',version:1,distanceM:1,difficulty:{unroundedScore:2.1}},{id:'a',version:1,distanceM:1,difficulty:{unroundedScore:2.1}},{id:'c',version:1,distanceM:0,difficulty:{unroundedScore:null}},{id:'d',version:1,distanceM:8,difficulty:{unroundedScore:1.2}}];
  const q=query({sort:'EASIEST',limit:2}),first=pageItems(structuredClone(items),q,2026);
  assert.deepEqual(first.items.map(x=>x.id),['d','a']);
  const second=pageItems(structuredClone(items),{...q,cursor:first.nextCursor!},2026);assert.deepEqual(second.items.map(x=>x.id),['b','c']);assert.equal(second.nextCursor,null);
  assert.throws(()=>pageItems(structuredClone(items),{...q,cursor:first.nextCursor!,vehicleWidthMm:2000},2026),/INVALID_SEARCH_CURSOR/);
  assert.throws(()=>pageItems(items.map(x=>({...x,version:2})),{...q,cursor:first.nextCursor!},2026),/SEARCH_CHANGED/);
  assert.throws(()=>pageItems(items,{...q,cursor:'not-json'},2026),ApiError);
  const tampered=JSON.parse(Buffer.from(first.nextCursor!,'base64url').toString()) as Record<string,unknown>;tampered.offset=-1;
  assert.throws(()=>pageItems(items,{...q,cursor:Buffer.from(JSON.stringify(tampered)).toString('base64url')},2026),ApiError);
  assert.deepEqual(pageItems(structuredClone(items),query(),2026).items.map(x=>x.id),['c','a','b','d']);
});
