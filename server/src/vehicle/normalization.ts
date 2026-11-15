import { createHash } from 'node:crypto';
import { ApiError } from '../api-error.js';
import { SIGNALS, type CapabilitiesDto, type Signal } from './dto.js';

export function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const object = value as Record<string, unknown>;
  return '{' + Object.keys(object).filter(k => object[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + canonical(object[k])).join(',') + '}';
}
export const fingerprint = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export const normalizeCapabilities = (value: CapabilitiesDto) => Object.fromEntries(SIGNALS.map(name => [name, { status: value[name].status, checkedAt: new Date(value[name].checkedAt).toISOString() }])) as Record<Signal, { status: string; checkedAt: string }>;

export function validateVersion(value: string) {
  if (value !== '1.0') throw new ApiError(422, 'CONTRACT_VERSION_UNSUPPORTED');
}
export function validateClock(value: string, now: Date, checkAge = true) {
  const timestamp = new Date(value).getTime();
  if (timestamp > now.getTime() + 5 * 60_000) throw new ApiError(422, 'CLOCK_SKEW');
  if (checkAge && timestamp < now.getTime() - 72 * 60 * 60_000) throw new ApiError(422, 'EVENT_TOO_OLD');
}
export function validateCapabilities(value: CapabilitiesDto, now: Date) {
  for (const name of SIGNALS) validateClock(value[name].checkedAt, now, false);
}
