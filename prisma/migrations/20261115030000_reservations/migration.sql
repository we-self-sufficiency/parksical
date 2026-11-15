-- CreateTable
CREATE TABLE "ReservationPolicy" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "structureVersion" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReservationPolicy_pkey" PRIMARY KEY ("lotId","version")
);

-- CreateTable
CREATE TABLE "ReservationQuote" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "mode" VARCHAR(16) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "amountKrw" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "receipt" JSONB NOT NULL,

    CONSTRAINT "ReservationQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "state" VARCHAR(24) NOT NULL,
    "paymentStatus" VARCHAR(32) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "holdExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "safetyRulesVersion" VARCHAR(32) NOT NULL,
    "safetyAgreedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "creationHash" CHAR(64) NOT NULL,
    "creationReceipt" JSONB NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReservationClaim" (
    "reservationId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReservationClaim_pkey" PRIMARY KEY ("reservationId","startsAt")
);

-- CreateTable
CREATE TABLE "ReservationAction" (
    "reservationId" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "ReservationAction_pkey" PRIMARY KEY ("reservationId","action")
);

-- CreateTable
CREATE TABLE "ReservationMutation" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "ReservationMutation_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "ReservationQuote_userId_createdAt_id_idx" ON "ReservationQuote"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_quoteId_key" ON "Reservation"("quoteId");

-- CreateIndex
CREATE INDEX "Reservation_lotId_state_holdExpiresAt_idx" ON "Reservation"("lotId", "state", "holdExpiresAt");

-- CreateIndex
CREATE INDEX "Reservation_userId_startsAt_id_idx" ON "Reservation"("userId", "startsAt", "id");

-- CreateIndex
CREATE INDEX "ReservationClaim_lotId_startsAt_idx" ON "ReservationClaim"("lotId", "startsAt");

-- AddForeignKey
ALTER TABLE "ReservationPolicy" ADD CONSTRAINT "ReservationPolicy_lotId_structureVersion_fkey" FOREIGN KEY ("lotId", "structureVersion") REFERENCES "LotRevision"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationQuote" ADD CONSTRAINT "ReservationQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationQuote" ADD CONSTRAINT "ReservationQuote_lotId_policyVersion_fkey" FOREIGN KEY ("lotId", "policyVersion") REFERENCES "ReservationPolicy"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "ReservationQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationClaim" ADD CONSTRAINT "ReservationClaim_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationAction" ADD CONSTRAINT "ReservationAction_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReservationMutation" ADD CONSTRAINT "ReservationMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE FUNCTION reject_reservation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Reservation policies, quotes, actions and receipts are immutable'; END $$;
CREATE TRIGGER reservation_policy_immutable BEFORE UPDATE ON "ReservationPolicy" FOR EACH ROW EXECUTE FUNCTION reject_reservation_immutable();
CREATE TRIGGER reservation_quote_immutable BEFORE UPDATE ON "ReservationQuote" FOR EACH ROW EXECUTE FUNCTION reject_reservation_immutable();
CREATE TRIGGER reservation_action_immutable BEFORE UPDATE ON "ReservationAction" FOR EACH ROW EXECUTE FUNCTION reject_reservation_immutable();
CREATE TRIGGER reservation_mutation_immutable BEFORE UPDATE ON "ReservationMutation" FOR EACH ROW EXECUTE FUNCTION reject_reservation_immutable();
ALTER TABLE "ReservationPolicy" ADD CONSTRAINT reservation_policy_source CHECK (snapshot ?& ARRAY['source','active'] AND jsonb_typeof(snapshot->'source')='string' AND snapshot->>'source'='SYNTHETIC' AND jsonb_typeof(snapshot->'active')='boolean');
ALTER TABLE "ReservationQuote" ADD CONSTRAINT reservation_quote_bounds CHECK (
  mode IN ('CHALLENGE','PRACTICE') AND "amountKrw" BETWEEN 0 AND 100000000 AND
  "startsAt">"createdAt" AND "endsAt">"startsAt" AND "expiresAt">"createdAt" AND "expiresAt"<="startsAt" AND
  mod(extract(epoch FROM "startsAt"),1800)=0 AND extract(epoch FROM ("endsAt"-"startsAt")) BETWEEN 1800 AND 14400 AND mod(extract(epoch FROM ("endsAt"-"startsAt")),1800)=0 AND
  details ?& ARRAY['currency','priceVersion','amountKrw'] AND jsonb_typeof(details->'amountKrw')='number' AND details->>'currency'='KRW' AND details->>'priceVersion'='reservation-price-v1' AND (details->>'amountKrw')::bigint="amountKrw"
);
ALTER TABLE "Reservation" ADD CONSTRAINT reservation_state_payment CHECK (
  (state IN ('HELD','CANCELLED','EXPIRED') AND "paymentStatus"='NOT_STARTED') OR
  (state='SANDBOX_CONFIRMED' AND "paymentStatus"='SANDBOX_SUCCEEDED') OR
  (state='PAYMENT_FAILED' AND "paymentStatus"='SANDBOX_FAILED') OR
  (state='REFUND_PENDING' AND "paymentStatus"='SANDBOX_REFUND_REQUIRED') OR
  (state='REFUNDED' AND "paymentStatus"='SANDBOX_REFUNDED')
);
ALTER TABLE "Reservation" ADD CONSTRAINT reservation_bounds CHECK (version>0 AND "holdExpiresAt">"createdAt" AND "holdExpiresAt"<="startsAt" AND "updatedAt">="createdAt");
CREATE FUNCTION guard_reservation_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'HELD' OR NEW.version<>1 OR NOT EXISTS (
      SELECT 1 FROM "ReservationQuote" q WHERE q.id=NEW."quoteId" AND q."userId"=NEW."userId" AND q."lotId"=NEW."lotId" AND q."startsAt"=NEW."startsAt" AND q."endsAt"=NEW."endsAt" AND q.details->>'safetyRulesVersion'=NEW."safetyRulesVersion"
    ) THEN RAISE EXCEPTION 'Reservation must match its owned frozen quote and safety version'; END IF;
  ELSE
    IF ROW(NEW.id,NEW."userId",NEW."quoteId",NEW."lotId",NEW."startsAt",NEW."endsAt",NEW."holdExpiresAt",NEW."safetyRulesVersion",NEW."safetyAgreedAt",NEW."createdAt",NEW."creationHash",NEW."creationReceipt") IS DISTINCT FROM
       ROW(OLD.id,OLD."userId",OLD."quoteId",OLD."lotId",OLD."startsAt",OLD."endsAt",OLD."holdExpiresAt",OLD."safetyRulesVersion",OLD."safetyAgreedAt",OLD."createdAt",OLD."creationHash",OLD."creationReceipt") OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Reservation identity, receipt and agreement are immutable; versions advance once';
    END IF;
    IF NOT ((OLD.state='HELD' AND NEW.state IN ('SANDBOX_CONFIRMED','CANCELLED','EXPIRED','PAYMENT_FAILED','REFUND_PENDING')) OR
            (OLD.state IN ('SANDBOX_CONFIRMED','EXPIRED','CANCELLED','PAYMENT_FAILED') AND NEW.state='REFUND_PENDING') OR
            (OLD.state='REFUND_PENDING' AND NEW.state='REFUNDED')) THEN
      RAISE EXCEPTION 'Invalid reservation state transition';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reservation_state_guard BEFORE INSERT OR UPDATE ON "Reservation" FOR EACH ROW EXECUTE FUNCTION guard_reservation_state();
CREATE FUNCTION guard_reservation_claim() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF mod(extract(epoch FROM NEW."startsAt"),1800)<>0 OR NOT EXISTS (
    SELECT 1 FROM "Reservation" r WHERE r.id=NEW."reservationId" AND r."lotId"=NEW."lotId" AND r.state='HELD' AND NEW."startsAt">=r."startsAt" AND NEW."startsAt"<r."endsAt"
  ) THEN RAISE EXCEPTION 'Invalid reservation slot claim'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reservation_claim_guard BEFORE INSERT ON "ReservationClaim" FOR EACH ROW EXECUTE FUNCTION guard_reservation_claim();
CREATE TRIGGER reservation_claim_immutable BEFORE UPDATE ON "ReservationClaim" FOR EACH ROW EXECUTE FUNCTION reject_reservation_immutable();
