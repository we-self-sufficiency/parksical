import 'reflect-metadata';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ObjectValidationPipe } from '../../src/validation.js';
import { readConfig } from '../../src/config.js';
import type { LotSnapshotDto } from '../../src/lots/dto.js';
import { ReservationHoldDto, ReservationPolicyWriteDto, ReservationQuoteDto, ReservationSlotsQuery } from '../../src/reservations/dto.js';
import { dayStart, horizon, localDay, quoteFare, safetyRules, validatePeriod, validatePolicy, validateVehicle } from '../../src/reservations/rules.js';
import { SandboxReservationPayments, UnavailableRealReservationPayments } from '../../src/reservations/payment-port.js';
const lot = (JSON.parse(readFileSync('fixtures/lots/one-synthetic-lot.json', 'utf8')) as { snapshot: LotSnapshotDto }).snapshot;
const fixture = JSON.parse(readFileSync('fixtures/reservations/synthetic-policy.json', 'utf8')) as ReservationPolicyWriteDto;
const policy = () => validatePolicy(structuredClone(fixture.snapshot), lot);
const now = new Date('2026-11-15T00:00:00.000Z'), start = new Date('2026-11-15T01:00:00.000Z');

test('reservations require explicit synthetic non-production opt-in; real payment verification is unavailable', () => {
  const env = { DATABASE_URL: 'postgresql://test@127.0.0.1/reservation_test', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: 'x'.repeat(40) };
  assert.equal(readConfig(env).devReservationsEnabled, false); assert.equal(readConfig({ ...env, DEV_RESERVATIONS_ENABLED: 'true' }).devReservationsEnabled, true);
  for (const patch of [{ NODE_ENV: 'production', DEV_RESERVATIONS_ENABLED: 'true' }, { DEV_AUTH_ENABLED: 'false', DEV_RESERVATIONS_ENABLED: 'true' }, { DEV_RESERVATIONS_ENABLED: 'yes' }, { REAL_RESERVATIONS_ENABLED: 'true' }]) assert.throws(() => readConfig({ ...env, ...patch }));
  assert.throws(() => new UnavailableRealReservationPayments().verify());
  const receipt = new SandboxReservationPayments().createSandboxEvidence('synthetic-reservation', 1750, 'PAYMENT_SUCCEEDED'); assert.equal(receipt.source, 'SANDBOX'); assert.equal(receipt.realPaymentVerified, false); assert.equal(receipt.amountKrw, 1750);
});
test('explicit synthetic venue policy validates hours, capacity, frozen safety text and vehicle/mode restrictions', () => {
  const p = policy(); assert.equal(p.fees!.baseAmount, 1000); assert.equal(p.safetyRules.length, 3); assert.throws(() => safetyRules('unreviewed-v2'));
  validateVehicle(p, 'PRACTICE', 4800, 1850);
  assert.throws(() => validateVehicle(p, 'PRACTICE', 5001, 1850)); assert.throws(() => validateVehicle({ ...p, allowedModes: ['PRACTICE'] }, 'CHALLENGE', 4800, 1850));
  for (const changed of [{ ...lot, active: false }, { ...lot, parkingType: 'MECHANICAL' }, { ...lot, fees: null }, { ...lot, operatingHours: null }]) assert.throws(() => validatePolicy(fixture.snapshot, changed));
  assert.throws(() => validatePolicy({ ...fixture.snapshot, capacity: 32 }, { ...lot, parkingSpaces: lot.parkingSpaces!.slice(0, 1) }));
  for (const hours of [[{ day: 1, openMinute: 1, closeMinute: 60 }], [{ day: 1, openMinute: 60, closeMinute: 30 }], [{ day: 1, openMinute: 0, closeMinute: 60 }, { day: 1, openMinute: 30, closeMinute: 90 }]]) assert.throws(() => validatePolicy({ ...fixture.snapshot, hours }, lot));
});
test('periods are grid-aligned 30-minute multiples, bounded to seven KST dates and permitted hours', () => {
  assert.equal(validatePeriod(policy(), start, 60, now).slots.length, 2);
  for (const minutes of [0, 29, 31, 45, 241]) assert.throws(() => validatePeriod(policy(), start, minutes, now));
  for (const time of [new Date(start.getTime() + 1), new Date(start.getTime() + 60000), now, horizon(now), new Date('invalid')]) assert.throws(() => validatePeriod(policy(), time, 30, now));
  assert.throws(() => validatePeriod({ ...policy(), hours: [] }, start, 30, now));
  assert.equal(localDay(dayStart('2026-11-16')).date, '2026-11-16'); assert.throws(() => dayStart('2026-02-30'));
  assert.equal(horizon(now).toISOString(), '2026-11-21T15:00:00.000Z');
});
test('frozen server fees use KRW integer math, per-date general caps and half-up mode multiplication', () => {
  const p = policy(), end = new Date(start.getTime() + 3600000);
  const challenge = quoteFare(p, 'CHALLENGE', start, end), practice = quoteFare(p, 'PRACTICE', start, end);
  assert.equal(challenge.generalAmountKrw, 2500); assert.equal(challenge.amountKrw, 4375); assert.equal(practice.amountKrw, 3125);
  p.fees!.dailyMaxAmount = 1000; assert.equal(quoteFare(p, 'PRACTICE', start, end).amountKrw, 1250);
  p.fees!.baseAmount = 1; p.fees!.additionalAmount = 0; p.fees!.dailyMaxAmount = null; p.practiceMultiplierBps = 15000;
  assert.equal(quoteFare(p, 'PRACTICE', start, end).amountKrw, 2); p.practiceMultiplierBps = 12500; assert.equal(quoteFare(p, 'PRACTICE', start, end).amountKrw, 1);
});
test('KST midnight splits base fee/cap by date and excessive computed amounts fail rather than overflow', () => {
  const begin = new Date('2026-11-15T14:30:00.000Z'), end = new Date('2026-11-15T15:30:00.000Z');
  const fare = quoteFare(policy(), 'PRACTICE', begin, end); assert.equal(fare.days.length, 2); assert.equal(fare.generalAmountKrw, 2000); assert.equal(fare.amountKrw, 2500);
  const p = policy(); p.fees = { currency: 'KRW', baseMinutes: 1, baseAmount: 10000000, additionalMinutes: 1, additionalAmount: 10000000, dailyMaxAmount: null };
  assert.throws(() => quoteFare(p, 'CHALLENGE', start, new Date(start.getTime() + 14400000)));
});
test('strict reservation inputs reject client prices, simulated parking proof, unknown fields and string body numbers', async () => {
  const pipe = new ObjectValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const quote = { lotId: '44444444-4444-4444-8444-444444444444', mode: 'PRACTICE', startsAt: start.toISOString(), durationMinutes: 30, lengthMm: 4800, widthMm: 1850 };
  await pipe.transform(quote, { type: 'body', metatype: ReservationQuoteDto });
  for (const patch of [{ amountKrw: 1 }, { durationMinutes: '30' }, { parked: true }, { source: 'REAL' }, { userId: 'other' }]) await assert.rejects(pipe.transform({ ...quote, ...patch }, { type: 'body', metatype: ReservationQuoteDto }));
  await assert.rejects(pipe.transform({ quoteId: quote.lotId, safetyRulesVersion: null, safetyAgreedAt: start.toISOString() }, { type: 'body', metatype: ReservationHoldDto }));
  await assert.rejects(pipe.transform({ ...fixture, snapshot: { ...fixture.snapshot, fees: { amountKrw: 1 } } }, { type: 'body', metatype: ReservationPolicyWriteDto }));
});
test('slot query coercion accepts bounded decimal integer strings only and rejects duplicate/ambiguous parameters', async () => {
  const pipe = new ObjectValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }), query = { date: '2026-11-15', mode: 'PRACTICE', lengthMm: '4800', widthMm: '1850' };
  const value = await pipe.transform(query, { type: 'query', metatype: ReservationSlotsQuery }) as ReservationSlotsQuery; assert.equal(value.lengthMm, 4800);
  for (const lengthMm of ['4.8e3', ' 4800', ['4800', '4900'], '4800.0']) await assert.rejects(pipe.transform({ ...query, lengthMm }, { type: 'query', metatype: ReservationSlotsQuery }));
});
