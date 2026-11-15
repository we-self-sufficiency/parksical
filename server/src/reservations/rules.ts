import { ApiError } from '../api-error.js';
import type { FeesDto, HoursDto, LotSnapshotDto } from '../lots/dto.js';
import type { ReservationMode, ReservationPolicyDto } from './dto.js';
export const HALF_HOUR_MS = 1800000;
const DAY = 86400000, KST = 9 * 3600000;
export const RESERVATION_PRICE_VERSION = 'reservation-price-v1';
export interface ReservationPolicySnapshot extends ReservationPolicyDto { fees: FeesDto | null; timezone: 'Asia/Seoul'; safetyRules: string[]; }
export function safetyRules(version: string) {
  if (version !== 'synthetic-safety-v1') throw new ApiError(422, 'RESERVATION_SAFETY_VERSION_UNSUPPORTED');
  return ['합성 테스트 전용이며 실제 장소/주행 허가가 아닙니다.', '앱의 로컬 주행 제한과 중단 판단을 우선하며 서버 응답을 기다리지 않습니다.', '안전상 정지/중단을 피하도록 운전하지 않으며 실제 차량/장소의 허가와 정책은 별도로 확인합니다.'];
}
function reject(code: string): never { throw new ApiError(422, code); }
export function localDay(date: Date) { const d = new Date(date.getTime() + KST); return { date: d.toISOString().slice(0, 10), day: d.getUTCDay() || 7, minute: d.getUTCHours() * 60 + d.getUTCMinutes() }; }
export function dayStart(date: string) {
  const d = new Date(date + 'T00:00:00.000+09:00');
  if (!Number.isFinite(d.getTime()) || localDay(d).date !== date) reject('INVALID_RESERVATION_DATE');
  return d;
}
export function horizon(now: Date) { return new Date(dayStart(localDay(now).date).getTime() + 7 * DAY); }
export function slotsBetween(start: Date, end: Date) { const out: Date[] = []; for (let ms = start.getTime(); ms < end.getTime(); ms += HALF_HOUR_MS) out.push(new Date(ms)); return out; }
export function inHours(slot: Date, hours: HoursDto[] | null) { const local = localDay(slot); return hours?.some(h => h.day === local.day && local.minute >= h.openMinute && local.minute + 30 <= h.closeMinute) ?? false; }
export function validatePolicy(dto: ReservationPolicyDto, lot: LotSnapshotDto): ReservationPolicySnapshot {
  const hours = [...dto.hours].sort((a, b) => a.day - b.day || a.openMinute - b.openMinute);
  for (const [i, h] of hours.entries()) {
    if (h.openMinute >= h.closeMinute || h.openMinute % 30 || h.closeMinute % 30 || (i > 0 && hours[i - 1]!.day === h.day && hours[i - 1]!.closeMinute > h.openMinute)) reject('INVALID_RESERVATION_HOURS');
  }
  if (dto.active && (!lot.active || lot.source !== 'SYNTHETIC' || lot.parkingType !== 'SELF_PARK' || lot.structureStatus !== 'COMPLETE' || !lot.fees || !lot.operatingHours?.length || !hours.length || dto.capacity > (lot.parkingSpaces?.filter(s => s.active && s.type === 'GENERAL').length ?? 0))) reject('RESERVATION_VENUE_UNAVAILABLE');
  if (dto.active) for (const h of hours) for (let minute = h.openMinute; minute < h.closeMinute; minute += 30) if (!lot.operatingHours!.some(w => w.day === h.day && minute >= w.openMinute && minute + 30 <= w.closeMinute)) reject('INVALID_RESERVATION_HOURS');
  return { ...dto, hours, fees: lot.fees ? { ...lot.fees } : null, timezone: 'Asia/Seoul', safetyRules: safetyRules(dto.safetyRulesVersion) };
}
export function validateVehicle(policy: ReservationPolicySnapshot, mode: ReservationMode, lengthMm: number, widthMm: number) {
  if (!policy.active) reject('RESERVATION_VENUE_UNAVAILABLE');
  if (!policy.allowedModes.includes(mode)) reject('RESERVATION_MODE_UNAVAILABLE');
  if (lengthMm > policy.maxLengthMm || widthMm > policy.maxWidthMm) reject('RESERVATION_VEHICLE_UNSUPPORTED');
}
export function validatePeriod(policy: ReservationPolicySnapshot, start: Date, minutes: number, now: Date) {
  if (!Number.isFinite(start.getTime()) || minutes < 30 || minutes > 240 || minutes % 30 || start.getTime() % HALF_HOUR_MS) reject('INVALID_RESERVATION_PERIOD');
  const end = new Date(start.getTime() + minutes * 60000);
  if (start <= now || end > horizon(now)) reject('RESERVATION_OUTSIDE_HORIZON');
  const slots = slotsBetween(start, end);
  if (slots.some(s => !inHours(s, policy.hours))) reject('RESERVATION_HOURS_UNAVAILABLE');
  return { end, slots };
}
export function quoteFare(policy: ReservationPolicySnapshot, mode: ReservationMode, start: Date, end: Date) {
  const fees = policy.fees; if (!fees) reject('RESERVATION_FEES_UNAVAILABLE');
  const {days,generalAmountKrw}=quoteGeneralFare(fees,start,end);
  const general=BigInt(generalAmountKrw),multiplierBps = mode === 'CHALLENGE' ? policy.challengeMultiplierBps : policy.practiceMultiplierBps;
  const amount = (general * BigInt(multiplierBps) + 5000n) / 10000n;
  if (amount > 100000000n) reject('RESERVATION_AMOUNT_LIMIT');
  return { currency: 'KRW', priceVersion: RESERVATION_PRICE_VERSION, generalAmountKrw, multiplierBps, amountKrw: Number(amount), rounding: 'HALF_UP_WON', dailyCapScope: 'GENERAL_FARE_PER_KST_DATE', days } as const;
}
export function quoteGeneralFare(fees: FeesDto, start: Date, end: Date) {
  const minutesByDay = new Map<string, number>();
  for (const slot of slotsBetween(start, end)) { const day = localDay(slot).date; minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + 30); }
  const days = [...minutesByDay].map(([date, minutes]) => {
    const increments = Math.ceil(Math.max(0, minutes - fees.baseMinutes) / fees.additionalMinutes);
    const uncapped = BigInt(fees.baseAmount) + BigInt(increments) * BigInt(fees.additionalAmount);
    const amount = fees.dailyMaxAmount === null ? uncapped : uncapped < BigInt(fees.dailyMaxAmount) ? uncapped : BigInt(fees.dailyMaxAmount);
    if (amount > 100000000n) reject('RESERVATION_AMOUNT_LIMIT');
    return { date, minutes, generalAmountKrw: Number(amount) };
  });
  const general = days.reduce((n, d) => n + BigInt(d.generalAmountKrw), 0n);
  if (general > 100000000n) reject('RESERVATION_AMOUNT_LIMIT');
  return {days,generalAmountKrw:Number(general)};
}
