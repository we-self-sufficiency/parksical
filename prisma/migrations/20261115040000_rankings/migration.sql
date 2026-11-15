BEGIN;

CREATE TABLE "RankingRecord" (
  "runId" UUID PRIMARY KEY REFERENCES "MissionRun"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  "publicId" UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  "rankingVersion" VARCHAR(32) NOT NULL DEFAULT 'rankings-v1',
  version INTEGER NOT NULL DEFAULT 1,
  "invalidatedAt" TIMESTAMPTZ(3), "invalidationReason" VARCHAR(32),
  "deletedAt" TIMESTAMPTZ(3), "deletionReason" VARCHAR(32),
  CONSTRAINT ranking_record_version CHECK (version=1+("invalidatedAt" IS NOT NULL)::integer+("deletedAt" IS NOT NULL)::integer),
  CONSTRAINT ranking_invalidation CHECK (("invalidatedAt" IS NULL AND "invalidationReason" IS NULL) OR ("invalidatedAt" IS NOT NULL AND "invalidationReason" IS NOT NULL AND "invalidationReason" IN ('USER_REQUEST','CORRECTION'))),
  CONSTRAINT ranking_deletion CHECK (("deletedAt" IS NULL AND "deletionReason" IS NULL) OR ("deletedAt" IS NOT NULL AND "deletionReason" IS NOT NULL AND "deletionReason" IN ('USER_REQUEST','CORRECTION')))
);
CREATE TABLE "RankingConsent" (
  "userId" UUID PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000), "policyVersion" VARCHAR(32) NOT NULL CHECK ("policyVersion"='rankings-public-v1'),
  enabled BOOLEAN NOT NULL, nickname VARCHAR(16) NOT NULL CHECK (nickname ~ '^P-[a-f0-9]{12}$'),
  "agreedAt" TIMESTAMPTZ(3), "changedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT ranking_consent_agreement CHECK (enabled=("agreedAt" IS NOT NULL))
);
CREATE TABLE "RankingConsentChange" (
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  version INTEGER NOT NULL CHECK (version BETWEEN 1 AND 1000), "policyVersion" VARCHAR(32) NOT NULL CHECK ("policyVersion"='rankings-public-v1'), enabled BOOLEAN NOT NULL,
  "agreedAt" TIMESTAMPTZ(3), "changedAt" TIMESTAMPTZ(3) NOT NULL,
  PRIMARY KEY ("userId",version), CONSTRAINT ranking_consent_history_agreement CHECK (enabled=("agreedAt" IS NOT NULL))
);
CREATE TABLE "RankingMutation" (
  "userId" UUID NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  key VARCHAR(64) NOT NULL, "requestHash" CHAR(64) NOT NULL, response JSONB NOT NULL, PRIMARY KEY ("userId",key)
);
CREATE TABLE "RankingMonthSnapshot" (
  id UUID PRIMARY KEY, "lotId" UUID NOT NULL, month CHAR(7) NOT NULL CHECK (month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
  "cohortKey" CHAR(64) NOT NULL, "rankingVersion" VARCHAR(32) NOT NULL CHECK ("rankingVersion"='rankings-v1'),
  "cutoffAt" TIMESTAMPTZ(3) NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL CHECK ("createdAt">="cutoffAt"),
  "inputHash" CHAR(64) NOT NULL, candidates JSONB NOT NULL CHECK (jsonb_typeof(candidates)='array' AND jsonb_array_length(candidates)<=10000), cohort JSONB NOT NULL,
  UNIQUE ("lotId",month,"cohortKey")
);
CREATE INDEX "MissionRun_lotId_startedAt_id_idx" ON "MissionRun"("lotId","startedAt",id);
-- A bounded development-wide lock serializes public withdrawal, source inserts and finalization.
-- The trigger also covers S-12/S-14 servers that do not yet know the ranking service.
CREATE FUNCTION serialize_synthetic_rankings() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('synthetic-rankings-v1',0));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER ranking_run_serialization BEFORE INSERT OR DELETE ON "MissionRun" FOR EACH ROW EXECUTE FUNCTION serialize_synthetic_rankings();
CREATE TRIGGER ranking_result_serialization BEFORE INSERT OR DELETE ON "MissionRunResult" FOR EACH ROW EXECUTE FUNCTION serialize_synthetic_rankings();
CREATE FUNCTION enroll_synthetic_ranking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode='CHALLENGE' THEN INSERT INTO "RankingRecord" ("runId") VALUES (NEW.id); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enroll_ranking AFTER INSERT ON "MissionRun" FOR EACH ROW EXECUTE FUNCTION enroll_synthetic_ranking();
-- Only membership; never manufacture recognition, consent, result metrics or public aliases.
INSERT INTO "RankingRecord" ("runId") SELECT id FROM "MissionRun" WHERE mode='CHALLENGE' ON CONFLICT ("runId") DO NOTHING;
CREATE FUNCTION guard_ranking_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('synthetic-rankings-v1',0));
  IF TG_OP='INSERT' THEN
    IF NEW."rankingVersion"<>'rankings-v1' OR NEW.version<>1 OR NOT EXISTS (SELECT 1 FROM "MissionRun" WHERE id=NEW."runId" AND mode='CHALLENGE' AND source='SYNTHETIC') THEN RAISE EXCEPTION 'Unsupported ranking membership'; END IF;
  ELSE
    IF NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."publicId" IS DISTINCT FROM OLD."publicId" OR NEW."rankingVersion" IS DISTINCT FROM OLD."rankingVersion" OR NEW.version<>OLD.version+1 OR
      (OLD."invalidatedAt" IS NOT NULL AND (NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt" OR NEW."invalidationReason" IS DISTINCT FROM OLD."invalidationReason")) OR
      (OLD."deletedAt" IS NOT NULL AND (NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" OR NEW."deletionReason" IS DISTINCT FROM OLD."deletionReason")) OR
      (OLD."deletedAt" IS NOT NULL) OR
      (OLD."invalidatedAt" IS NULL AND NEW."invalidatedAt" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "MissionRunResult" WHERE "runId"=NEW."runId")) THEN RAISE EXCEPTION 'Ranking deletion/invalidation is monotonic'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ranking_record_guard BEFORE INSERT OR UPDATE ON "RankingRecord" FOR EACH ROW EXECUTE FUNCTION guard_ranking_record();
CREATE FUNCTION guard_ranking_consent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('synthetic-rankings-v1',0));
  IF (TG_OP='INSERT' AND NEW.version<>1) OR (TG_OP='UPDATE' AND (NEW."userId" IS DISTINCT FROM OLD."userId" OR NEW.nickname IS DISTINCT FROM OLD.nickname OR NEW.version<>OLD.version+1)) THEN RAISE EXCEPTION 'Consent requires consecutive versions and a stable generated alias'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ranking_consent_guard BEFORE INSERT OR UPDATE ON "RankingConsent" FOR EACH ROW EXECUTE FUNCTION guard_ranking_consent();
CREATE TRIGGER ranking_consent_history_immutable BEFORE UPDATE ON "RankingConsentChange" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();
CREATE TRIGGER ranking_mutation_immutable BEFORE UPDATE ON "RankingMutation" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();
CREATE TRIGGER ranking_snapshot_immutable BEFORE UPDATE ON "RankingMonthSnapshot" FOR EACH ROW EXECUTE FUNCTION reject_mission_update();

CREATE INDEX "RankingMutation_userId_requestHash_idx" ON "RankingMutation"("userId","requestHash");

COMMIT;
