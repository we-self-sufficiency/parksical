-- CreateTable
CREATE TABLE "PracticeRecord" (
    "runId" UUID NOT NULL,
    "goalVersion" VARCHAR(32) NOT NULL DEFAULT 'practice-v1',
    "invalidatedAt" TIMESTAMPTZ(3),
    "invalidationReason" VARCHAR(32),

    CONSTRAINT "PracticeRecord_pkey" PRIMARY KEY ("runId")
);

-- CreateTable
CREATE TABLE "PracticeRecognition" (
    "id" UUID NOT NULL,
    "cohortKey" CHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "installationId" UUID NOT NULL,
    "referenceRunId" UUID NOT NULL,
    "goalVersion" VARCHAR(32) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "qualifyingRunId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PracticeRecognition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PracticeMutation" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "runId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "PracticeMutation_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "PracticeRecognition_cohortKey_key" ON "PracticeRecognition"("cohortKey");

-- CreateIndex
CREATE INDEX "PracticeRecognition_userId_installationId_id_idx" ON "PracticeRecognition"("userId", "installationId", "id");

-- AddForeignKey
ALTER TABLE "PracticeRecord" ADD CONSTRAINT "PracticeRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MissionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeRecognition" ADD CONSTRAINT "PracticeRecognition_referenceRunId_fkey" FOREIGN KEY ("referenceRunId") REFERENCES "MissionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PracticeMutation" ADD CONSTRAINT "PracticeMutation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MissionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Practice membership is pinned at creation, including inserts from an older S-12 server.
-- Backfill only membership, never rewrite immutable runs/results or fabricate metrics.
CREATE FUNCTION enroll_synthetic_practice() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode='PRACTICE' THEN
    INSERT INTO "PracticeRecord" ("runId","goalVersion") VALUES (NEW.id,'practice-v1');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enroll_practice AFTER INSERT ON "MissionRun" FOR EACH ROW EXECUTE FUNCTION enroll_synthetic_practice();
INSERT INTO "PracticeRecord" ("runId","goalVersion") SELECT id,'practice-v1' FROM "MissionRun" WHERE mode='PRACTICE';
ALTER TABLE "PracticeRecord" ADD CONSTRAINT practice_invalidation CHECK (
  ("invalidatedAt" IS NULL AND "invalidationReason" IS NULL) OR
  ("invalidatedAt" IS NOT NULL AND "invalidationReason" IS NOT NULL AND "invalidationReason" IN ('USER_REQUEST','CORRECTION'))
);
CREATE FUNCTION guard_practice_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW."goalVersion" <> 'practice-v1' OR NOT EXISTS (SELECT 1 FROM "MissionRun" WHERE id=NEW."runId" AND mode='PRACTICE' AND source='SYNTHETIC') THEN
      RAISE EXCEPTION 'Only supported synthetic practice can be enrolled';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "MissionRunResult" WHERE "runId"=NEW."runId") THEN
      RAISE EXCEPTION 'Only terminal practice can be invalidated';
    END IF;
    IF NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."goalVersion" IS DISTINCT FROM OLD."goalVersion" OR OLD."invalidatedAt" IS NOT NULL OR NEW."invalidatedAt" IS NULL THEN
      RAISE EXCEPTION 'Practice identity, goal version and invalidation are immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER practice_record_guard BEFORE INSERT OR UPDATE ON "PracticeRecord" FOR EACH ROW EXECUTE FUNCTION guard_practice_record();
ALTER TABLE "PracticeRecognition" ADD CONSTRAINT practice_qualification CHECK (active=("qualifyingRunId" IS NOT NULL));
CREATE TRIGGER practice_mutation_immutable BEFORE UPDATE ON "PracticeMutation" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();
