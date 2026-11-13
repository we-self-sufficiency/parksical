import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateDifficulty, type DifficultyInput, type FactorInput } from '../../src/difficulty/calculator.js';
import { DifficultyInputError, difficultyRule } from '../../src/difficulty/rules.js';

const factor=(score:number|null,sampleCount:number|null=null,source:FactorInput['source']='SYNTHETIC'):FactorInput=>({score,sampleCount,source});
const base=():DifficultyInput=>({asOfYear:2026,lotSource:'SYNTHETIC',builtYear:2020,factors:{structure:factor(2.5),review:factor(null),driving:factor(null)}});
const vehicle=(lengthMm:number,widthMm:number)=>({status:'SUPPORTED' as const,lengthMm,widthMm});

test('difficulty weighted factors, sample eligibility, year derivation and exact rule trace',()=>{
  const input=base();input.builtYear=2006;input.factors={structure:factor(4),review:factor(2,5,'OBSERVED'),driving:factor(3,20,'OBSERVED')};
  const result=calculateDifficulty(input);
  assert.equal(result.baseScore,3.15);assert.equal(result.score,3);assert.equal(result.dataSource,'MIXED');
  assert.equal(result.coverage.availableWeight,1);assert.equal(result.ruleVersion,'difficulty-v1');
  assert.equal(result.factors.find(f=>f.name==='age')!.score,3);
  assert.deepEqual(result.rule.weights,{structure:40,review:25,driving:20,age:15});
  assert.ok(result.caveats.includes('SYNTHETIC_DATA'));assert.ok(result.caveats.includes('NOT_A_PARKABILITY_ASSESSMENT'));
});
test('difficulty excludes missing, small and unverified samples without zero imputation',()=>{
  const input=base();input.factors.review=factor(5,4);input.factors.driving=factor(5,null);
  let r=calculateDifficulty(input);
  assert.equal(r.baseScore,2.254545);assert.equal(r.coverage.availableWeight,.55);
  assert.equal(r.factors[1]!.status,'INSUFFICIENT_SAMPLES');assert.equal(r.factors[2]!.status,'SAMPLE_COUNT_UNKNOWN');
  assert.equal(r.factors[1]!.contribution,null);assert.equal(r.factors[2]!.sampleCount,null);
  input.factors.review=factor(5,5);input.factors.driving=factor(5,19);r=calculateDifficulty(input);
  assert.equal(r.factors[1]!.status,'INCLUDED');assert.equal(r.factors[2]!.status,'INSUFFICIENT_SAMPLES');
  input.factors.driving=factor(5,20);assert.equal(calculateDifficulty(input).coverage.availableWeight,1);
  input.factors.structure=factor(5,null,'UNKNOWN');assert.equal(calculateDifficulty(input).factors[0]!.status,'UNVERIFIED_SOURCE');
});
test('difficulty insufficient coverage remains unknown, including age-only and vehicle-only inputs',()=>{
  const input=base();input.factors.structure=factor(null);input.vehicle=vehicle(10000,4000);
  let r=calculateDifficulty(input);assert.equal(r.status,'INSUFFICIENT_DATA');assert.equal(r.score,null);assert.equal(r.baseScore,null);assert.equal(r.unroundedScore,null);
  assert.equal(r.coverage.availableWeight,.15);
  input.builtYear=null;r=calculateDifficulty(input);assert.equal(r.coverage.availableWeight,0);assert.equal(r.dataSource,'UNKNOWN');assert.equal(r.score,null);
  input.factors.structure=factor(2.5);assert.equal(calculateDifficulty(input).status,'SCORED');
});
test('difficulty year unknown/future and unsupported dimensions retain explicit reference basis',()=>{
  const input=base();input.builtYear=2027;
  assert.equal(calculateDifficulty(input).factors[3]!.status,'FUTURE_BUILT_YEAR');
  input.builtYear=null;assert.equal(calculateDifficulty(input).factors[3]!.score,null);
  for(const status of ['UNKNOWN','UNSUPPORTED','PERMISSION_DENIED','ERROR'] as const){
    input.vehicle={status,lengthMm:null,widthMm:null};const r=calculateDifficulty(input);
    assert.equal(r.vehicle.basis,'REFERENCE_DEFAULT');assert.equal(r.vehicle.inputStatus,status);assert.equal(r.vehicle.appliedAdjustment,0);
  }
  input.builtYear=1800;assert.equal(calculateDifficulty(input).factors[3]!.score,5);
});
test('difficulty clipping and six-decimal, half-up 0.5 boundaries',()=>{
  for(const [value,expected] of [[1,1],[1.249999,1],[1.25,1.5],[2.249999,2],[2.25,2.5],[4.75,5],[5,5]]){
    const input=base();input.builtYear=null;input.factors.structure=factor(value!);
    assert.equal(calculateDifficulty(input).score,expected);
  }
  let input=base();input.factors.structure=factor(5);input.builtYear=1800;input.vehicle=vehicle(10000,4000);
  assert.equal(calculateDifficulty(input).unroundedScore,5);assert.equal(calculateDifficulty(input).vehicle.appliedAdjustment,1.5);
  input=base();input.factors.structure=factor(1);input.builtYear=null;input.vehicle=vehicle(1000,500);
  assert.equal(calculateDifficulty(input).score,1);assert.equal(calculateDifficulty(input).vehicle.appliedAdjustment,-1.5);
});
test('difficulty is monotone on each vehicle axis and satisfies 5100mm >= 3600mm',()=>{
  for(const score of [1,2.5,5]){
    const input=base();input.factors.structure=factor(score);
    for(let width=500;width<=4000;width+=100){
      let previous=-Infinity,previousRaw=-Infinity;
      for(let length=1000;length<=10000;length+=100){
        const r=calculateDifficulty({...input,vehicle:vehicle(length,width)});
        assert.ok(r.score!>=previous);assert.ok(r.unroundedScore!>=previousRaw);previous=r.score!;previousRaw=r.unroundedScore!;
      }
    }
    for(let length=1000;length<=10000;length+=200){
      let previous=-Infinity;
      for(let width=500;width<=4000;width+=50){const r=calculateDifficulty({...input,vehicle:vehicle(length,width)});assert.ok(r.score!>=previous);previous=r.score!;}
    }
    assert.ok(calculateDifficulty({...input,vehicle:vehicle(5100,1850)}).score!>=calculateDifficulty({...input,vehicle:vehicle(3600,1850)}).score!);
  }
});
test('difficulty rejects invalid inputs, pins rules and never mutates reusable inputs',()=>{
  const input=base(),copy=structuredClone(input);assert.deepEqual(calculateDifficulty(input),calculateDifficulty(copy));assert.deepEqual(input,copy);
  assert.throws(()=>calculateDifficulty({...input,ruleVersion:'future'}),DifficultyInputError);
  for(const value of [NaN,Infinity,0,5.1])assert.throws(()=>calculateDifficulty({...input,factors:{...input.factors,structure:factor(value)}}),DifficultyInputError);
  assert.throws(()=>calculateDifficulty({...input,vehicle:vehicle(999,1850)}),DifficultyInputError);
  assert.throws(()=>calculateDifficulty({...input,vehicle:{status:'UNSUPPORTED',lengthMm:4800,widthMm:1850}}),DifficultyInputError);
  assert.throws(()=>calculateDifficulty({...input,asOfYear:1999}),DifficultyInputError);
  assert.throws(()=>{Object.assign(difficultyRule().weights,{structure:0})},TypeError);
});
