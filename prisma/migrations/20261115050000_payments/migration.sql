-- CreateTable
BEGIN;
CREATE TABLE "PaymentQuote" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "structureVersion" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "amountKrw" INTEGER NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "receipt" JSONB NOT NULL,

    CONSTRAINT "PaymentQuote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "quoteId" UUID,
    "reservationId" UUID,
    "lotId" UUID NOT NULL,
    "amountKrw" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "pricing" JSONB NOT NULL,
    "state" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "creationReceipt" JSONB NOT NULL,

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "orderId" UUID NOT NULL,
    "sandboxOutcome" VARCHAR(16) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "transactionId" UUID,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "orderId" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "amountKrw" INTEGER NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("orderId")
);

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMutation" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB,

    CONSTRAINT "PaymentMutation_pkey" PRIMARY KEY ("userId","key")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "eventId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "SandboxProviderPayment" (
    "orderId" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amountKrw" INTEGER NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "status" VARCHAR(16) NOT NULL,

    CONSTRAINT "SandboxProviderPayment_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_quoteId_key" ON "PaymentOrder"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_reservationId_key" ON "PaymentOrder"("reservationId");

-- CreateIndex
CREATE INDEX "PaymentOrder_userId_createdAt_id_idx" ON "PaymentOrder"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_transactionId_key" ON "PaymentAttempt"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReceipt_orderId_key" ON "PaymentReceipt"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxProviderPayment_transactionId_key" ON "SandboxProviderPayment"("transactionId");

-- AddForeignKey
ALTER TABLE "PaymentQuote" ADD CONSTRAINT "PaymentQuote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentQuote" ADD CONSTRAINT "PaymentQuote_lotId_structureVersion_fkey" FOREIGN KEY ("lotId","structureVersion") REFERENCES "LotRevision"("lotId","version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "PaymentQuote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMutation" ADD CONSTRAINT "PaymentMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentProviderEvent" ADD CONSTRAINT "PaymentProviderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentQuote" ADD CONSTRAINT payment_quote_bounds CHECK ("amountKrw" BETWEEN 1 AND 100000000 AND "createdAt"<"expiresAt" AND "expiresAt"<="startsAt" AND "startsAt"<"endsAt" AND "structureVersion">0 AND details->>'currency'='KRW' AND (details->>'amountKrw')::bigint="amountKrw");
ALTER TABLE "PaymentOrder" ADD CONSTRAINT payment_order_bounds CHECK (("quoteId" IS NULL)<>("reservationId" IS NULL) AND "amountKrw" BETWEEN 1 AND 100000000 AND currency='KRW' AND "createdAt"<"expiresAt" AND state IN ('CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED'));
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT payment_attempt_bounds CHECK ("sandboxOutcome" IN ('SUCCEEDED','FAILED') AND state IN ('PENDING','SUCCEEDED','FAILED') AND ((state='PENDING' AND "transactionId" IS NULL) OR (state<>'PENDING' AND "transactionId" IS NOT NULL)));
ALTER TABLE "PaymentRefund" ADD CONSTRAINT payment_refund_bounds CHECK ("amountKrw" BETWEEN 1 AND 100000000 AND state IN ('PENDING','SUCCEEDED'));
ALTER TABLE "SandboxProviderPayment" ADD CONSTRAINT sandbox_provider_bounds CHECK (currency='KRW' AND "amountKrw" BETWEEN 1 AND 100000000 AND outcome IN ('SUCCEEDED','FAILED') AND ((outcome='FAILED' AND status='FAILED') OR (outcome='SUCCEEDED' AND status IN ('SUCCEEDED','REFUNDED'))));
CREATE FUNCTION payment_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable payment record'; END $$;
CREATE TRIGGER payment_quote_immutable BEFORE UPDATE ON "PaymentQuote" FOR EACH ROW EXECUTE FUNCTION payment_immutable();
CREATE TRIGGER payment_receipt_immutable BEFORE UPDATE ON "PaymentReceipt" FOR EACH ROW EXECUTE FUNCTION payment_immutable();
CREATE TRIGGER payment_event_immutable BEFORE UPDATE ON "PaymentProviderEvent" FOR EACH ROW EXECUTE FUNCTION payment_immutable();
CREATE FUNCTION guard_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'CREATED' OR NOT (
      (NEW."quoteId" IS NOT NULL AND EXISTS (SELECT 1 FROM "PaymentQuote" q WHERE q.id=NEW."quoteId" AND q."userId"=NEW."userId" AND q."lotId"=NEW."lotId" AND q."amountKrw"=NEW."amountKrw" AND q.details=NEW.pricing AND q."expiresAt"=NEW."expiresAt")) OR
      (NEW."reservationId" IS NOT NULL AND EXISTS (SELECT 1 FROM "Reservation" r JOIN "ReservationQuote" q ON q.id=r."quoteId" WHERE r.id=NEW."reservationId" AND r."userId"=NEW."userId" AND r."lotId"=NEW."lotId" AND q."amountKrw"=NEW."amountKrw" AND q.details=NEW.pricing AND r."holdExpiresAt"=NEW."expiresAt" AND r.state='HELD'))
    ) THEN RAISE EXCEPTION 'Order must match an owned immutable quote or held reservation'; END IF;
  ELSE
    IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR NOT (
      (OLD.state='CREATED' AND NEW.state IN ('PENDING','CANCELLED')) OR
      (OLD.state='PENDING' AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')) OR
      (OLD.state IN ('SUCCEEDED','CANCELLED') AND NEW.state IN ('REFUND_PENDING','REFUNDED')) OR
      (OLD.state='REFUND_PENDING' AND NEW.state='REFUNDED')
    ) THEN RAISE EXCEPTION 'Invalid payment order mutation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_order_guard BEFORE INSERT OR UPDATE ON "PaymentOrder" FOR EACH ROW EXECUTE FUNCTION guard_payment_order();
CREATE FUNCTION guard_payment_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' OR NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o.id=NEW."orderId" AND o.state='CREATED') THEN RAISE EXCEPTION 'Attempt must start once on a created order'; END IF;
  ELSE
    IF ROW(NEW."orderId",NEW."sandboxOutcome") IS DISTINCT FROM ROW(OLD."orderId",OLD."sandboxOutcome") OR
      (OLD."transactionId" IS NOT NULL AND NEW."transactionId" IS DISTINCT FROM OLD."transactionId") OR
      (OLD.state<>'PENDING' AND NEW.state<>OLD.state) THEN RAISE EXCEPTION 'Invalid payment attempt mutation'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_attempt_guard BEFORE INSERT OR UPDATE ON "PaymentAttempt" FOR EACH ROW EXECUTE FUNCTION guard_payment_attempt();
CREATE FUNCTION guard_payment_refund() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o.id=NEW."orderId" AND o."amountKrw"=NEW."amountKrw") OR
    (TG_OP='UPDATE' AND (ROW(NEW."orderId",NEW."amountKrw") IS DISTINCT FROM ROW(OLD."orderId",OLD."amountKrw") OR OLD.state='SUCCEEDED' AND NEW.state<>'SUCCEEDED')) THEN RAISE EXCEPTION 'Only one full refund per order'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_refund_guard BEFORE INSERT OR UPDATE ON "PaymentRefund" FOR EACH ROW EXECUTE FUNCTION guard_payment_refund();
CREATE FUNCTION guard_payment_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."userId",NEW.key,NEW."requestHash") IS DISTINCT FROM ROW(OLD."userId",OLD.key,OLD."requestHash") OR (OLD.response IS NOT NULL AND NEW.response IS DISTINCT FROM OLD.response) THEN RAISE EXCEPTION 'Immutable payment command receipt'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_mutation_guard BEFORE UPDATE ON "PaymentMutation" FOR EACH ROW EXECUTE FUNCTION guard_payment_mutation();
CREATE FUNCTION guard_sandbox_provider() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') OR NOT (OLD.status='SUCCEEDED' AND NEW.status='REFUNDED') THEN RAISE EXCEPTION 'Invalid sandbox provider mutation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sandbox_provider_guard BEFORE UPDATE ON "SandboxProviderPayment" FOR EACH ROW EXECUTE FUNCTION guard_sandbox_provider();
COMMIT;
