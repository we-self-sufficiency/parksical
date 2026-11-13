import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approachFootprint, fitsZone, footprintsOverlap, pillarFootprint, spaceFootprint } from '../../src/lots/layout.js';
import type { ParkingSpaceDto, PillarDto } from '../../src/lots/dto.js';

const rectangle=(x:number,y:number,w:number,h:number)=>[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}];
test('layout preserves physical dimensions, heading and explicit unknown geometry',()=>{
  const p={center:{x:10,y:10},widthMm:2500,lengthMm:5000,headingDegrees:90} as ParkingSpaceDto;
  const poly=spaceFootprint(p)!;
  assert.ok(Math.abs(Math.max(...poly.map(v=>v.x))-Math.min(...poly.map(v=>v.x))-2.5)<1e-8);
  assert.ok(Math.abs(Math.max(...poly.map(v=>v.y))-Math.min(...poly.map(v=>v.y))-5)<1e-8);
  assert.equal(spaceFootprint({...p,headingDegrees:null}),null);
  assert.equal(pillarFootprint({center:null,widthMm:600,depthMm:600,rotationDegrees:0} as PillarDto),null);
});
test('layout overlap rejects interior intersections, allows boundary touch and respects rotations',()=>{
  const a=rectangle(0,0,2,5);
  assert.equal(footprintsOverlap(a,rectangle(2,0,2,5)),false);
  assert.equal(footprintsOverlap(a,rectangle(1.9,0,2,5)),true);
  assert.equal(footprintsOverlap(a,a),true);
  const rotated=spaceFootprint({center:{x:3,y:3},widthMm:2500,lengthMm:5000,headingDegrees:45} as ParkingSpaceDto)!;
  assert.equal(footprintsOverlap(a,rotated),true);
});
test('containment checks concave boundaries between corners, not just bounding boxes',()=>{
  const zone=[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:7,y:10},{x:7,y:2},{x:6,y:2},{x:6,y:10},{x:0,y:10},{x:0,y:0}];
  assert.equal(fitsZone(rectangle(1,1,8,8),zone),false,'narrow notch intersects rectangle away from its midpoint');
  assert.equal(fitsZone(rectangle(1,1,4,8),zone),true);
  assert.equal(fitsZone(rectangle(-1,1,2,2),zone),false);
});
test('a pillar can block maneuvering even when it does not overlap the parking bay',()=>{
  const p={center:{x:10,y:8.6},widthMm:2600,lengthMm:5200,headingDegrees:90,approach:{aisleId:'main',side:'FRONT',depthMm:6800,lateralClearanceMm:500}} as ParkingSpaceDto;
  const pillar=rectangle(9.7,11.3,.6,.6);
  assert.equal(footprintsOverlap(spaceFootprint(p)!,pillar),false,'old bay-only check misses this obstruction');
  assert.equal(footprintsOverlap(approachFootprint(p)!,pillar),true,'maneuvering area must stay empty');
  const box=approachFootprint(p)!;
  assert.ok(Math.abs(Math.max(...box.map(x=>x.y))-18)<1e-8);
});
