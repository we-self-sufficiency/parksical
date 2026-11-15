-- CreateEnum
CREATE TYPE "VehicleSessionState" AS ENUM ('ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "VehicleEventType" AS ENUM ('CAPABILITIES_REPORTED', 'SESSION_CLOSED');

-- CreateEnum
CREATE TYPE "EventDisposition" AS ENUM ('APPLIED', 'STORED_OUT_OF_ORDER');

-- CreateEnum
CREATE TYPE "ReportedSource" AS ENUM ('SYNTHETIC', 'APP_REPORTED');

-- CreateTable
CREATE TABLE "VehicleSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "authSessionId" UUID NOT NULL,
    "creationKey" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "creationResponse" JSONB NOT NULL,
    "contractVersion" VARCHAR(16) NOT NULL,
    "appVersion" VARCHAR(32) NOT NULL,
    "reportedSource" "ReportedSource" NOT NULL,
    "state" "VehicleSessionState" NOT NULL DEFAULT 'ACTIVE',
    "capabilities" JSONB NOT NULL,
    "lastAppliedSequence" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedOccurredAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "VehicleSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleEvent" (
    "sessionId" UUID NOT NULL,
    "eventId" VARCHAR(64) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "VehicleEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "disposition" "EventDisposition" NOT NULL,
    "receipt" JSONB NOT NULL,

    CONSTRAINT "VehicleEvent_pkey" PRIMARY KEY ("sessionId","eventId")
);

-- CreateIndex
CREATE INDEX "VehicleSession_userId_installationId_idx" ON "VehicleSession"("userId", "installationId");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleSession_authSessionId_creationKey_key" ON "VehicleSession"("authSessionId", "creationKey");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleEvent_sessionId_sequence_key" ON "VehicleEvent"("sessionId", "sequence");

-- AddForeignKey
ALTER TABLE "VehicleSession" ADD CONSTRAINT "VehicleSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSession" ADD CONSTRAINT "VehicleSession_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleSession" ADD CONSTRAINT "VehicleSession_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VehicleEvent" ADD CONSTRAINT "VehicleEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VehicleSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
