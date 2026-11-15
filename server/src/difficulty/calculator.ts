import { DifficultyInputError, difficultyRule } from './rules.js';

export type EvidenceSource = 'SYNTHETIC' | 'OBSERVED' | 'UNKNOWN';
export type VehicleStatus = 'SUPPORTED' | 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'ERROR' | 'UNKNOWN';
export type FactorName = 'structure' | 'review' | 'driving' | 'age';
export interface FactorInput { score: number | null; source: EvidenceSource; sampleCount: number | null; }
export interface VehicleInput { status: VehicleStatus; lengthMm: number | null; widthMm: number | null; }
export interface DifficultyInput {
  ruleVersion?: string;
  asOfYear: number;
  lotSource: EvidenceSource;
  builtYear: number | null;
  factors: { structure: FactorInput; review: FactorInput; driving: FactorInput };
  vehicle?: VehicleInput;
}
type FactorStatus = 'INCLUDED' | 'MISSING_SCORE' | 'UNVERIFIED_SOURCE' | 'SAMPLE_COUNT_UNKNOWN' | 'INSUFFICIENT_SAMPLES' | 'BUILT_YEAR_UNKNOWN' | 'FUTURE_BUILT_YEAR';
export interface FactorResult {
  name: FactorName; score: number | null; source: EvidenceSource; sampleCount: number | null;
  origin: 'AUTHORED' | 'AGGREGATE' | 'DERIVED_BUILT_YEAR'; status: FactorStatus;
  nominalWeight: number; normalizedWeight: number; contribution: number | null;
}
const SCALE = 1_000_000;
const bad = () => { throw new DifficultyInputError('INVALID_DIFFICULTY_INPUT'); };
const sourceValid = (s: EvidenceSource) => ['SYNTHETIC','OBSERVED','UNKNOWN'].includes(s);
const integer = (n: number, lo: number, hi: number) => Number.isSafeInteger(n) && n >= lo && n <= hi;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi,Math.max(lo,n));

/** Pure, version-pinned heuristic. No clock, HTTP, database, SDK or data collection. */
export function calculateDifficulty(input: DifficultyInput) {
  const rule = difficultyRule(input.ruleVersion);
  if (!integer(input.asOfYear,2000,2200) || !sourceValid(input.lotSource) ||
      (input.builtYear !== null && !integer(input.builtYear,1800,2200))) bad();
  const vehicle: VehicleInput = input.vehicle ?? { status:'UNKNOWN',lengthMm:null,widthMm:null };
  if (!['SUPPORTED','UNSUPPORTED','PERMISSION_DENIED','ERROR','UNKNOWN'].includes(vehicle.status)) bad();
  if (vehicle.status === 'SUPPORTED') {
    if (!integer(vehicle.lengthMm!,1000,10000) || !integer(vehicle.widthMm!,500,4000)) bad();
  } else if (vehicle.lengthMm !== null || vehicle.widthMm !== null) bad();

  const factors: FactorResult[] = [];
  for (const name of ['structure','review','driving'] as const) {
    const value = input.factors[name];
    if (!value || !sourceValid(value.source) || (value.score !== null && (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score<1 || value.score>5)) ||
        (value.sampleCount !== null && !integer(value.sampleCount,0,2147483647))) bad();
    let status: FactorStatus = value.score === null ? 'MISSING_SCORE' : value.source === 'UNKNOWN' ? 'UNVERIFIED_SOURCE' : 'INCLUDED';
    if (status === 'INCLUDED' && name !== 'structure') {
      if (value.sampleCount === null) status='SAMPLE_COUNT_UNKNOWN';
      else if (value.sampleCount < rule.minimumSamples[name]) status='INSUFFICIENT_SAMPLES';
    }
    factors.push({ name,score:value.score===null?null:Math.round(value.score*SCALE)/SCALE,source:value.source,sampleCount:value.sampleCount,
      origin:name==='structure'?'AUTHORED':'AGGREGATE',status,nominalWeight:rule.weights[name]/100,normalizedWeight:0,contribution:null });
  }
  const ageStatus: FactorStatus = input.builtYear===null?'BUILT_YEAR_UNKNOWN':input.builtYear>input.asOfYear?'FUTURE_BUILT_YEAR':input.lotSource==='UNKNOWN'?'UNVERIFIED_SOURCE':'INCLUDED';
  const ageScore = ageStatus==='INCLUDED' ? (SCALE+Math.min(rule.age.maximumYears,input.asOfYear-input.builtYear!)*Math.round(rule.age.pointsPerYear*SCALE))/SCALE : null;
  factors.push({name:'age',score:ageScore,source:input.lotSource,sampleCount:null,origin:'DERIVED_BUILT_YEAR',status:ageStatus,nominalWeight:rule.weights.age/100,normalizedWeight:0,contribution:null});
  const included = factors.filter(f=>f.status==='INCLUDED');
  const weightPercent = included.reduce((n,f)=>n+rule.weights[f.name],0);
  const numerator = included.reduce((n,f)=>n+Math.round(f.score!*SCALE)*rule.weights[f.name],0);
  for (const f of included) {
    f.normalizedWeight=rule.weights[f.name]/weightPercent;
    f.contribution=Math.round(Math.round(f.score!*SCALE)*rule.weights[f.name]/weightPercent)/SCALE;
  }
  const dimensions = vehicle.status==='SUPPORTED' ? {lengthMm:vehicle.lengthMm!,widthMm:vehicle.widthMm!} : {...rule.referenceVehicle};
  // Integer microunits: 0.8/1.6 points per metre = 800/1600 microunits per mm.
  const rawCorrection=(dimensions.lengthMm-rule.referenceVehicle.lengthMm)*Math.round(rule.vehicleCorrection.lengthPointsPerMetre*SCALE/1000)+(dimensions.widthMm-rule.referenceVehicle.widthMm)*Math.round(rule.vehicleCorrection.widthPointsPerMetre*SCALE/1000);
  const adjustmentLimit=Math.round(rule.vehicleCorrection.maximumAbsolutePoints*SCALE);
  const correction=clamp(rawCorrection,-adjustmentLimit,adjustmentLimit);
  const enough = weightPercent>=rule.minimumCoverageWeight;
  const baseMicros = enough ? Math.round(numerator/weightPercent) : null;
  const finalMicros = baseMicros===null?null:clamp(baseMicros+correction,rule.score.minimum*SCALE,rule.score.maximum*SCALE);
  const stepMicros=Math.round(rule.score.displayStep*SCALE);
  const sources = new Set(included.map(f=>f.source));
  const dataSource = sources.size>1?'MIXED':sources.size===1?[...sources][0]!:'UNKNOWN';
  const caveats=['NOT_A_PARKABILITY_ASSESSMENT'];
  if (sources.has('SYNTHETIC')) caveats.push('SYNTHETIC_DATA');
  if (weightPercent<100) caveats.push('PARTIAL_DATA');
  if (!enough) caveats.push('BELOW_MINIMUM_COVERAGE');
  if (factors[0]!.status!=='INCLUDED') caveats.push('STRUCTURE_FACTOR_MISSING');
  if (vehicle.status!=='SUPPORTED') caveats.push('REFERENCE_VEHICLE_USED');
  return {
    ruleVersion:rule.version,asOfYear:input.asOfYear,status:enough?'SCORED' as const:'INSUFFICIENT_DATA' as const,
    score:finalMicros===null?null:Math.floor((finalMicros+stepMicros/2)/stepMicros)*rule.score.displayStep,
    unroundedScore:finalMicros===null?null:finalMicros/SCALE,baseScore:baseMicros===null?null:baseMicros/SCALE,
    dataSource,coverage:{availableWeight:weightPercent/100,minimumWeight:rule.minimumCoverageWeight/100,includedFactorCount:included.length,excludedFactors:factors.filter(f=>f.status!=='INCLUDED').map(f=>f.name)},
    vehicle:{inputStatus:vehicle.status,basis:vehicle.status==='SUPPORTED'?'PROVIDED_DIMENSIONS' as const:'REFERENCE_DEFAULT' as const,dimensionsMm:dimensions,referenceMm:{...rule.referenceVehicle},rawAdjustment:rawCorrection/SCALE,appliedAdjustment:correction/SCALE},
    factors,rule,caveats,
  };
}
