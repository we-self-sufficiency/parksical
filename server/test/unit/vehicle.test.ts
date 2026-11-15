import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint, validateClock, validateVersion } from '../../src/vehicle/normalization.js';

test('canonical object order is stable, payload changes are distinct', () => {
  assert.equal(fingerprint({ b: [2, { x: null, a: 1 }], a: 'v' }), fingerprint({ a: 'v', b: [2, { a: 1, x: null }] }));
  assert.notEqual(fingerprint({ a: [1, 2] }), fingerprint({ a: [2, 1] }));
});
test('version and inclusive clock boundaries', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  validateVersion('1.0'); assert.throws(() => validateVersion('2.0'));
  validateClock(new Date(now.getTime() - 72 * 3600_000).toISOString(), now);
  validateClock(new Date(now.getTime() + 300_000).toISOString(), now);
  assert.throws(() => validateClock(new Date(now.getTime() - 72 * 3600_000 - 1).toISOString(), now));
  assert.throws(() => validateClock(new Date(now.getTime() + 300_001).toISOString(), now));
});
