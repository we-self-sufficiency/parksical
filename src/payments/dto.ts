import { IsIn, IsInt, IsISO8601, IsUUID, Matches, Max, Min } from 'class-validator';
export class PaymentQuoteDto {
  @IsUUID() lotId!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) startsAt!: string;
  @IsInt() @Min(30) @Max(240) durationMinutes!: number;
}
export class PaymentOrderDto { @IsUUID() quoteId!: string; }
export class ReservationPaymentOrderDto { @IsUUID() reservationId!: string; }
export class PaymentAttemptDto { @IsIn(['SUCCEEDED', 'FAILED']) sandboxOutcome!: 'SUCCEEDED' | 'FAILED'; }
export class PaymentCancelDto { @IsIn(['USER_REQUEST']) reason!: 'USER_REQUEST'; }
export class PaymentRecoverDto { @IsIn(['RECOVER']) action!: 'RECOVER'; }
export class PaymentWebhookDto {
  @IsUUID() eventId!: string;
  @IsUUID() orderId!: string;
  @IsUUID() transactionId!: string;
  @IsIn(['SUCCEEDED', 'FAILED', 'REFUNDED']) status!: 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
  @IsIn(['KRW']) currency!: 'KRW';
  @IsInt() @Min(1) @Max(100000000) amountKrw!: number;
}
