-- CreateTable
CREATE TABLE "MissionRun" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "authSessionId" UUID NOT NULL,
    "vehicleSessionId" UUID NOT NULL,
    "clientRunId" VARCHAR(64) NOT NULL,
    "creationHash" CHAR(64) NOT NULL,
    "creationResponse" JSONB NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'SYNTHETIC',
    "mode" VARCHAR(16) NOT NULL,
    "lotId" UUID NOT NULL,
    "structureVersion" INTEGER NOT NULL,
    "ruleVersion" VARCHAR(32) NOT NULL,
    "rules" JSONB NOT NULL,
    "stages" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionRunResult" (
    "runId" UUID NOT NULL,
    "clientResultId" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'SYNTHETIC',
    "outcome" VARCHAR(16) NOT NULL,
    "stars" INTEGER NOT NULL,
    "finishedAt" TIMESTAMPTZ(3) NOT NULL,
    "elapsedMs" INTEGER NOT NULL,
    "report" JSONB NOT NULL,
    "assessment" JSONB NOT NULL,
    "receipt" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionRunResult_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "MissionRunMutation" (
    "userId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "runId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "MissionRunMutation_pkey" PRIMARY KEY ("userId","installationId","key")
);

-- CreateIndex
CREATE INDEX "MissionRun_userId_startedAt_id_idx" ON "MissionRun"("userId", "startedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MissionRun_userId_installationId_clientRunId_key" ON "MissionRun"("userId", "installationId", "clientRunId");

-- AddForeignKey
ALTER TABLE "MissionRun" ADD CONSTRAINT "MissionRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionRun" ADD CONSTRAINT "MissionRun_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionRun" ADD CONSTRAINT "MissionRun_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionRun" ADD CONSTRAINT "MissionRun_vehicleSessionId_fkey" FOREIGN KEY ("vehicleSessionId") REFERENCES "VehicleSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionRun" ADD CONSTRAINT "MissionRun_lotId_structureVersion_fkey" FOREIGN KEY ("lotId", "structureVersion") REFERENCES "LotRevision"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionRunResult" ADD CONSTRAINT "MissionRunResult_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MissionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionRunMutation" ADD CONSTRAINT "MissionRunMutation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MissionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Enforce source/status/bounds at the persistence boundary as well as the DTO boundary.
ALTER TABLE "MissionRun" ADD CONSTRAINT "mission_run_source" CHECK (source='SYNTHETIC');
ALTER TABLE "MissionRun" ADD CONSTRAINT "mission_run_mode" CHECK (mode IN ('CHALLENGE','PRACTICE'));
ALTER TABLE "MissionRun" ADD CONSTRAINT "mission_run_rules" CHECK (jsonb_typeof(rules)='object' AND rules ? 'version' AND rules->>'version'="ruleVersion" AND jsonb_typeof(stages)='array' AND jsonb_array_length(stages) BETWEEN 1 AND 3);
ALTER TABLE "MissionRunResult" ADD CONSTRAINT "mission_result_source" CHECK (source='SYNTHETIC');
ALTER TABLE "MissionRunResult" ADD CONSTRAINT "mission_result_bounds" CHECK ("elapsedMs" BETWEEN 0 AND 86400000 AND ((outcome='COMPLETED' AND stars BETWEEN 0 AND 9) OR (outcome IN ('ABORTED','UNVERIFIABLE') AND stars=0)));
CREATE FUNCTION reject_mission_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Mission attempts, final results and receipts are immutable'; END $$;
CREATE TRIGGER mission_run_immutable BEFORE UPDATE ON "MissionRun" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();
CREATE TRIGGER mission_result_immutable BEFORE UPDATE ON "MissionRunResult" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();
CREATE TRIGGER mission_mutation_immutable BEFORE UPDATE ON "MissionRunMutation" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();
