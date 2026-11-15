import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { readConfig } from '../../src/config.js';
import { ObjectValidationPipe } from '../../src/validation.js';
import { RunCreateDto,RunResultDto } from '../../src/missions/dto.js';
import { missionCatalog,missionRules,validateRunResult,type StagePlan } from '../../src/missions/rules.js';
import type { LotSnapshotDto } from '../../src/lots/dto.js';
const snapshot=(JSON.parse(readFileSync('fixtures/lots/one-synthetic-lot.json','utf8')) as {snapshot:LotSnapshotDto}).snapshot;
const fixture=JSON.parse(readFileSync('fixtures/missions/result-scenarios.json','utf8')) as {startedAt:string;scenarios:{name:string;result:RunResultDto}[]};
const plans=missionCatalog(snapshot).items.flatMap(i=>i.stage?[i.stage]:[]);
const now=new Date('2026-11-15T00:01:00.000Z'),start=new Date(fixture.startedAt);
const check=(r:RunResultDto,selected?:StagePlan[])=>validateRunResult(selected??[plans.find(p=>p.stageId===r.stages[0]!.stageId)!],missionRules(),start,r,now);
function scenario(name:string){return structuredClone(fixture.scenarios.find(c=>c.name===name)!.result);}

test('mission configuration is explicit non-production opt-in, REAL always rejected',()=>{
  const env={DATABASE_URL:'postgresql://test@127.0.0.1/missions_test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'x'.repeat(40)};
  assert.equal(readConfig(env).devMissionsEnabled,false);assert.equal(readConfig({...env,DEV_MISSIONS_ENABLED:'true'}).devMissionsEnabled,true);
  for(const patch of [{NODE_ENV:'production',DEV_MISSIONS_ENABLED:'true'},{DEV_AUTH_ENABLED:'false',DEV_MISSIONS_ENABLED:'true'},{DEV_MISSIONS_ENABLED:'yes'},{REAL_MISSIONS_ENABLED:'true'}])assert.throws(()=>readConfig({...env,...patch}));
});
test('catalog exposes synthetic-only references and disables unsupported obstacle/time missions',()=>{
  const c=missionCatalog(snapshot);assert.equal(c.items.length,5);assert.equal(c.operationalAllowed,false);assert.equal(plans.length,3);
  assert.equal(c.items.find(i=>i.missionCode==='PILLAR_FOREST')!.disabledReason,'OBSTACLE_EVIDENCE_UNCONFIRMED');
  assert.equal(c.items.find(i=>i.missionCode==='TIME_ATTACK')!.stage,null);
  const reverse=plans.find(p=>p.missionCode==='ONE_SHOT_REVERSE')!;assert.ok(snapshot.parkingSpaces!.some(s=>s.id===reverse.parkingSpaceId && s.type==='GENERAL'));
  assert.throws(()=>missionRules('unknown-v2'));
  c.rules.maxSpeedKph=100;assert.equal(missionRules().maxSpeedKph,10);
});
test('shared success/failure/abort/quality/restart fixtures are schema-valid but never physically eligible',()=>{
  for(const c of fixture.scenarios){assert.deepEqual(validateSync(plainToInstance(RunResultDto,c.result)),[],c.name);const a=check(c.result);assert.equal(a.outcome,c.result.outcome);assert.equal(a.physicalVerification,'UNVERIFIED');assert.equal(a.recognitionStatus,'SYNTHETIC_NOT_ELIGIBLE');assert.equal(a.rankingEligible,false);assert.equal(a.rewardEligible,false);}
});
test('strict nested input rejects raw signals, ambiguous nulls, numeric strings and invalid outcomes',async()=>{
  const pipe=new ObjectValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true});
  const valid=scenario('reverse-success');await pipe.transform(valid,{type:'body',metatype:RunResultDto});
  for(const patch of [{source:'APP_REPORTED'},{stars:10},{elapsedMs:'1000'},{stages:null},{expectedVersion:2},{rawSignals:[1]}])await assert.rejects(pipe.transform({...valid,...patch},{type:'body',metatype:RunResultDto}));
  for(const patch of [{quality:[null]},{metrics:{...valid.stages[0]!.metrics,steeringAngle:360}},{quality:valid.stages[0]!.quality.map(q=>({...q,signal:'speed'}))},{segmentExited:undefined},{parkingConfirmed:undefined},{metrics:null}])await assert.rejects(pipe.transform({...valid,stages:[{...valid.stages[0],...patch}]},{type:'body',metatype:RunResultDto}));
  assert.ok(validateSync(plainToInstance(RunCreateDto,{source:'SYNTHETIC'})).length);
});
test('forged stars, stage reference/order, signal coverage, duration and terminal contradiction are rejected',()=>{
  for(const modify of [(r:RunResultDto)=>{r.stars=2;},(r:RunResultDto)=>{r.stages[0]!.stars=2;},(r:RunResultDto)=>{r.stages[0]!.stageId='ONE_SHOT_REVERSE:unknown';},(r:RunResultDto)=>{r.stages[0]!.endOffsetMs=0;},(r:RunResultDto)=>{r.stages[0]!.endOffsetMs=1001;},(r:RunResultDto)=>{r.finishedAt='2026-11-15T00:00:30.000Z';},(r:RunResultDto)=>{r.stages[0]!.quality[0]!.validSampleCount=1;},(r:RunResultDto)=>{r.stages[0]!.quality[0]!.coveredMs=1001;},(r:RunResultDto)=>{r.stages[0]!.segmentExited=false;},(r:RunResultDto)=>{r.stages[0]!.parkingConfirmed=false;}]){const r=scenario('reverse-success');modify(r);assert.throws(()=>check(r));}
  const stopped=scenario('ramp-stopped');stopped.outcome='COMPLETED';stopped.reason='FINISHED';stopped.stages[0]!.outcome='FAILED';stopped.stages[0]!.reason='FINISHED';assert.throws(()=>check(stopped));
  const aborted=scenario('speed-abort');aborted.outcome='COMPLETED';assert.throws(()=>check(aborted));
  const noStage=scenario('reverse-success');noStage.stages=[];assert.throws(()=>check(noStage,plans));
});
test('speed threshold, danger dedup summary and quality do not turn gaps/stationary into success',()=>{
  const r=scenario('reverse-success');r.stages[0]!.metrics.maxSpeedKph=10;assert.equal(check(r).stars,3);
  r.stages[0]!.metrics.maxSpeedKph=10.001;assert.throws(()=>check(r));
  const gap=scenario('reverse-success');gap.stages[0]!.quality[0]!.maxGapMs=1001;assert.throws(()=>check(gap));
  const noSamples=scenario('reverse-success');noSamples.stages[0]!.quality[0]!.validSampleCount=2;assert.throws(()=>check(noSamples));
  const parked=scenario('reverse-success');parked.stages[0]!.metrics.movingDurationMs=1000;assert.throws(()=>check(parked));
  const a=scenario('stationary-not-success');assert.equal(check(a).outcome,'UNVERIFIABLE');
});
test('multiple stages require exact frozen order, no overlap, correct total, no faster-time bonus',()=>{
  const a=scenario('ramp-success').stages[0]!,b=scenario('smooth-two-stars').stages[0]!;
  b.startOffsetMs=1000;b.endOffsetMs=2000;
  const r={...scenario('ramp-success'),elapsedMs:2000,finishedAt:'2026-11-15T00:00:02.000Z',stars:5,stages:[a,b]};
  const selected=[plans.find(p=>p.stageId===a.stageId)!,plans.find(p=>p.stageId===b.stageId)!];assert.equal(check(r,selected).stars,5);
  const reversed=structuredClone(r);reversed.stages.reverse();assert.throws(()=>check(reversed,selected));
  const overlap=structuredClone(r);overlap.stages[1]!.startOffsetMs=999;assert.throws(()=>check(overlap,selected));
  // Durations alone earn nothing: an added between-stage gap has no score effect.
  const slower=structuredClone(r);slower.elapsedMs=3000;slower.finishedAt='2026-11-15T00:00:03.000Z';slower.stages[1]!.startOffsetMs+=1000;slower.stages[1]!.endOffsetMs+=1000;assert.equal(check(slower,selected).stars,5);
});
test('pre-stage cancellation/restart and timeout are explicit zero-reward terminal records',()=>{
  const r=scenario('cancel-abort');r.stages=[];r.elapsedMs=0;r.finishedAt=fixture.startedAt;assert.equal(check(r,plans).outcome,'ABORTED');
  r.reason='UX_RESTRICTED';assert.equal(check(r,plans).outcome,'ABORTED');
  r.reason='SPEED_LIMIT';assert.throws(()=>check(r,plans));
  r.reason='APP_RESTARTED';r.outcome='UNVERIFIABLE';assert.equal(check(r,plans).stars,0);
  r.reason='TIME_LIMIT';r.outcome='ABORTED';r.elapsedMs=7200001;r.finishedAt=new Date(start.getTime()+r.elapsedMs).toISOString();assert.equal(validateRunResult(plans,missionRules(),start,r,new Date(start.getTime()+r.elapsedMs)).stars,0);
});

test('optional gear transitions cannot exceed observed samples or fabricate unavailable observations',()=>{
  const r=scenario('reverse-success');r.stages[0]!.metrics.gearTransitionCount=2;
  assert.throws(()=>check(r));
  const gear=r.stages[0]!.quality.find(q=>q.signal==='gear')!;gear.validSampleCount=3;
  assert.equal(check(r).outcome,'COMPLETED');
  r.stages[0]!.metrics.gearTransitionCount=3;assert.throws(()=>check(r));
  gear.status='MISSING';gear.validSampleCount=0;gear.coveredMs=0;gear.maxGapMs=null;
  r.stages[0]!.metrics.gearTransitionCount=0;assert.throws(()=>check(r));
});
