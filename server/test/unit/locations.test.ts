import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import sharp from 'sharp';
import { readConfig } from '../../src/config.js';
import { cursorLocation,locationCursor } from '../../src/locations/pagination.js';
import { MAX_PHOTO_BYTES,normalizePhoto,photoBytes } from '../../src/locations/photos.js';
import { LocationCreateDto,LocationPatchDto } from '../../src/locations/dto.js';

test('location feature is explicit non-production opt-in and cannot enable real collection',()=>{
  const env={DATABASE_URL:'postgresql://test@127.0.0.1/location_test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'x'.repeat(40)};
  assert.equal(readConfig(env).devLocationsEnabled,false);assert.equal(readConfig({...env,DEV_LOCATIONS_ENABLED:'true'}).devLocationsEnabled,true);
  for(const patch of [{NODE_ENV:'production',DEV_LOCATIONS_ENABLED:'true'},{DEV_AUTH_ENABLED:'false',DEV_LOCATIONS_ENABLED:'true'},{DEV_LOCATIONS_ENABLED:'yes'},{REAL_LOCATIONS_ENABLED:'true'}])assert.throws(()=>readConfig({...env,...patch}));
});
test('location DTO keeps null/unknown, strict timestamps, bounded notes and body integers',()=>{
  const valid={clientRecordId:'record-1',lotId:'66666666-6666-4666-8666-666666666666',structureVersion:null,floorId:null,zoneId:null,parkingSpaceId:null,confidence:'UNKNOWN',distanceM:null,occurredAt:'2026-11-14T00:00:00Z',source:'SYNTHETIC'};
  assert.equal(validateSync(plainToInstance(LocationCreateDto,valid)).length,0);
  for(const patch of [{floorId:undefined},{structureVersion:'1'},{occurredAt:'2026-02-30T00:00:00Z'},{confidence:'CERTAIN'},{distanceM:-1},{source:'APP_REPORTED'},{note:'x'.repeat(1001)}])assert.ok(validateSync(plainToInstance(LocationCreateDto,{...valid,...patch})).length);
  assert.equal(validateSync(plainToInstance(LocationPatchDto,{expectedVersion:1,note:null,floorId:null})).length,0);
  assert.ok(validateSync(plainToInstance(LocationPatchDto,{expectedVersion:'1'})).length);
});
test('location cursor binds owner/page size and never contains timestamps or location coordinates',()=>{
  const id='77777777-7777-4777-8777-777777777777',cursor=locationCursor('synthetic-owner',20,id);
  assert.equal(cursorLocation('synthetic-owner',20,cursor),id);assert.throws(()=>cursorLocation('someone-else',20,cursor));assert.throws(()=>cursorLocation('synthetic-owner',50,cursor));assert.throws(()=>cursorLocation('synthetic-owner',20,'bad'));
  assert.ok(!Buffer.from(cursor,'base64url').toString().includes('synthetic-owner'));
});
test('photo codec checks canonical bounded encoding, real formats and pixel limits',async()=>{
  assert.deepEqual(photoBytes(Buffer.from('hello').toString('base64')),Buffer.from('hello'));
  for(const value of ['','YQ','YQ=','YQ==\n','YR==','https://example.invalid/image.png'])assert.throws(()=>photoBytes(value));
  assert.throws(()=>photoBytes(Buffer.alloc(MAX_PHOTO_BYTES+1).toString('base64')),/IMAGE_TOO_LARGE/);
  const png=await sharp({create:{width:32,height:16,channels:3,background:'#abc'}}).png().toBuffer();
  await assert.rejects(normalizePhoto(png,'image/jpeg'),/INVALID_IMAGE/);await assert.rejects(normalizePhoto(Buffer.from('<svg></svg>'),'image/png'),/INVALID_IMAGE/);
  await assert.rejects(normalizePhoto(png.subarray(0,20),'image/png'),/INVALID_IMAGE/);
  const oversized=await sharp({create:{width:4000,height:4000,channels:3,background:'#abc'}}).png().toBuffer();await assert.rejects(normalizePhoto(oversized,'image/png'),/INVALID_IMAGE/);
  const acTL=Buffer.concat([png.subarray(0,8),Buffer.from([0,0,0,0]),Buffer.from('acTL'),Buffer.alloc(4),png.subarray(8)]);await assert.rejects(normalizePhoto(acTL,'image/png'),/INVALID_IMAGE/);
});
test('photo normalization decodes/re-encodes pixels, shrinks images and drops metadata',async()=>{
  const input=await sharp({create:{width:2500,height:1000,channels:3,background:'#123456'}}).withExif({IFD0:{Artist:'synthetic-private-marker'}}).jpeg().toBuffer();
  assert.ok((await sharp(input).metadata()).exif);
  const output=await normalizePhoto(input,'image/jpeg'),meta=await sharp(output.bytes).metadata();
  assert.equal(meta.format,'jpeg');assert.equal(output.width,2048);assert.ok(output.height<=2048);assert.equal(meta.exif,undefined);assert.equal(meta.icc,undefined);assert.ok(!output.bytes.includes(Buffer.from('synthetic-private-marker')));
});
