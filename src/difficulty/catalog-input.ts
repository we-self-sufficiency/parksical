import { ApiError } from '../api-error.js';
import type { LotSnapshotDto } from '../lots/dto.js';
import { calculateDifficulty, type VehicleInput, type FactorInput } from './calculator.js';
import type { DifficultyQueryDto } from './dto.js';
import { difficultyRule, DifficultyInputError } from './rules.js';

export function difficultyContext(query:DifficultyQueryDto,defaultYear:number) {
  const status=query.vehicleStatus??(query.vehicleLengthMm!==undefined || query.vehicleWidthMm!==undefined?'SUPPORTED':'UNKNOWN');
  const vehicle:VehicleInput={status,lengthMm:query.vehicleLengthMm??null,widthMm:query.vehicleWidthMm??null};
  if((status==='SUPPORTED' && (vehicle.lengthMm===null || vehicle.widthMm===null)) || (status!=='SUPPORTED' && (vehicle.lengthMm!==null || vehicle.widthMm!==null)))throw new ApiError(400,'INVALID_VEHICLE_DIMENSIONS');
  try{difficultyRule(query.ruleVersion);}catch(e){if(e instanceof DifficultyInputError)throw new ApiError(422,e.code);throw e;}
  return {vehicle,asOfYear:query.asOfYear??defaultYear,ruleVersion:query.ruleVersion};
}
export function catalogDifficulty(snapshot:Pick<LotSnapshotDto,'source'|'builtYear'|'factorScores'>,context:ReturnType<typeof difficultyContext>,review?:FactorInput) {
  if(snapshot.source!=='SYNTHETIC')throw new ApiError(422,'LOT_SOURCE_UNSUPPORTED');
  try {
    const result=calculateDifficulty({...context,lotSource:'SYNTHETIC',builtYear:snapshot.builtYear,
      factors:{structure:{score:snapshot.factorScores.structure,source:'SYNTHETIC',sampleCount:null},review:review??{score:snapshot.factorScores.review,source:'SYNTHETIC',sampleCount:null},driving:{score:snapshot.factorScores.driving,source:'SYNTHETIC',sampleCount:null}}});
    // Suppress small-group means in API evidence while retaining the exclusion reason.
    return {...result,factors:result.factors.map(f=>f.name==='review' && f.status==='INSUFFICIENT_SAMPLES'?{...f,score:null}:f)};
  }catch(e){if(e instanceof DifficultyInputError)throw new ApiError(422,e.code);throw e;}
}
