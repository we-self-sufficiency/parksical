export const CURRENT_DIFFICULTY_RULE = 'difficulty-v1';
const v1 = Object.freeze({
  version: CURRENT_DIFFICULTY_RULE,
  weights: Object.freeze({ structure: 40, review: 25, driving: 20, age: 15 }),
  minimumSamples: Object.freeze({ review: 5, driving: 20 }),
  minimumCoverageWeight: 40,
  referenceVehicle: Object.freeze({ lengthMm: 4800, widthMm: 1850 }),
  vehicleCorrection: Object.freeze({ lengthPointsPerMetre: 0.8, widthPointsPerMetre: 1.6, maximumAbsolutePoints: 1.5 }),
  age: Object.freeze({ pointsPerYear: 0.1, maximumYears: 40 }),
  score: Object.freeze({ minimum: 1, maximum: 5, displayStep: 0.5, calculationDecimals: 6 }),
});
const rules = Object.freeze({ [CURRENT_DIFFICULTY_RULE]: v1 });
export class DifficultyInputError extends Error {
  constructor(readonly code: 'INVALID_DIFFICULTY_INPUT' | 'DIFFICULTY_RULE_UNSUPPORTED') { super(code); }
}
export function difficultyRule(version = CURRENT_DIFFICULTY_RULE) {
  if (!Object.hasOwn(rules, version)) throw new DifficultyInputError('DIFFICULTY_RULE_UNSUPPORTED');
  return rules[version as keyof typeof rules];
}
