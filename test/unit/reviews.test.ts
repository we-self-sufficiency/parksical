import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewAverage,reviewEvidence,sumRatings } from '../../src/reviews/aggregation.js';
import { readConfig } from '../../src/config.js';
import { pageItems } from '../../src/lots/search.js';
import type { LotSearchQuery } from '../../src/lots/search.dto.js';
import { catalogDifficulty,difficultyContext } from '../../src/difficulty/catalog-input.js';

test('review rating scale, deterministic means and invalid totals',()=>{
  assert.equal(sumRatings(['EASY','NORMAL','HARD']),9);
  assert.equal(reviewAverage({scoreSum:0n,sampleCount:0}),null);
  assert.equal(reviewAverage({scoreSum:7n,sampleCount:3}),2.333333);
  for(const totals of [{scoreSum:4n,sampleCount:5},{scoreSum:26n,sampleCount:5},{scoreSum:1n,sampleCount:0}])assert.throws(()=>reviewAverage(totals));
});
test('review small groups suppress means while preserving sample evidence and S-07 exclusion',()=>{
  const small=reviewEvidence(true,{scoreSum:4n,sampleCount:4,version:1,updatedAt:new Date('2026-11-14T00:00:00Z'),source:'SYNTHETIC'});
  assert.equal(small.publishedScore,null);assert.equal(small.metadata.status,'INSUFFICIENT_SAMPLES');
  const result=catalogDifficulty({source:'SYNTHETIC',builtYear:2020,factorScores:{structure:2.5,review:null,driving:null,age:null}},difficultyContext({asOfYear:2026},2026),small.factor);
  assert.equal(result.factors[1]!.status,'INSUFFICIENT_SAMPLES');assert.equal(result.factors[1]!.score,null);assert.equal(result.coverage.availableWeight,.55);
  assert.equal(reviewEvidence(true,{scoreSum:15n,sampleCount:5,version:1,updatedAt:new Date(),source:'SYNTHETIC'}).publishedScore,3);
  assert.equal(reviewEvidence(false).metadata.sampleCount,null);assert.equal(reviewEvidence(false).factor,undefined);
  assert.throws(()=>reviewEvidence(true,{scoreSum:5n,sampleCount:5,version:1,updatedAt:new Date(),source:'OBSERVED'}));
});
test('review policy is explicit opt-in, cannot activate real collection or production',()=>{
  const env={DATABASE_URL:'postgresql://test@127.0.0.1/reviews_test',DEV_AUTH_ENABLED:'true',DEV_AUTH_SECRET:'x'.repeat(40)};
  assert.equal(readConfig(env).devReviewsEnabled,false);
  assert.equal(readConfig({...env,DEV_REVIEWS_ENABLED:'true'}).devReviewsEnabled,true);
  for(const patch of [{NODE_ENV:'production',DEV_REVIEWS_ENABLED:'true'},{DEV_AUTH_ENABLED:'false',DEV_REVIEWS_ENABLED:'true'},{DEV_REVIEWS_ENABLED:'yes'},{REAL_REVIEWS_ENABLED:'true'}])assert.throws(()=>readConfig({...env,...patch}));
});
test('review aggregate changes invalidate search cursors even when distance order is unchanged',()=>{
  const rows=[{id:'a',version:1,distanceM:1,difficulty:{unroundedScore:2,reviewAggregation:{version:1}}},{id:'b',version:1,distanceM:2,difficulty:{unroundedScore:3,reviewAggregation:{version:null}}}];
  const q={latitude:0,longitude:0,limit:1} as LotSearchQuery;const first=pageItems(structuredClone(rows),q,2026);
  rows[0]!.difficulty.reviewAggregation.version=2;
  assert.throws(()=>pageItems(rows,{...q,cursor:first.nextCursor!},2026),/SEARCH_CHANGED/);
});
