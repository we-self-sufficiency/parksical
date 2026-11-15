-- CreateTable
CREATE TABLE "ParkingLot" (
    "id" UUID NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "currentVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParkingLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LotRevision" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "ownership" VARCHAR(16) NOT NULL,
    "parkingType" VARCHAR(16) NOT NULL,
    "partnered" BOOLEAN NOT NULL,
    "builtYear" INTEGER,
    "source" VARCHAR(16) NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3) NOT NULL,
    "structureStatus" VARCHAR(16) NOT NULL,
    "challengeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotRevision_pkey" PRIMARY KEY ("lotId","version")
);

-- CreateTable
CREATE TABLE "LotFloor" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "id" VARCHAR(32) NOT NULL,

    CONSTRAINT "LotFloor_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateTable
CREATE TABLE "LotZone" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "floorId" VARCHAR(32) NOT NULL,
    "id" VARCHAR(32) NOT NULL,

    CONSTRAINT "LotZone_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateTable
CREATE TABLE "LotEntrance" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "floorId" VARCHAR(32) NOT NULL,
    "zoneId" VARCHAR(32),

    CONSTRAINT "LotEntrance_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateTable
CREATE TABLE "LotRamp" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "fromFloorId" VARCHAR(32) NOT NULL,
    "toFloorId" VARCHAR(32) NOT NULL,
    "fromZoneId" VARCHAR(32),
    "toZoneId" VARCHAR(32),

    CONSTRAINT "LotRamp_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateTable
CREATE TABLE "LotMutation" (
    "authSessionId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LotMutation_pkey" PRIMARY KEY ("authSessionId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParkingLot_code_key" ON "ParkingLot"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LotZone_lotId_version_floorId_id_key" ON "LotZone"("lotId", "version", "floorId", "id");

-- AddForeignKey
ALTER TABLE "LotRevision" ADD CONSTRAINT "LotRevision_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ParkingLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotFloor" ADD CONSTRAINT "LotFloor_lotId_version_fkey" FOREIGN KEY ("lotId", "version") REFERENCES "LotRevision"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotZone" ADD CONSTRAINT "LotZone_lotId_version_floorId_fkey" FOREIGN KEY ("lotId", "version", "floorId") REFERENCES "LotFloor"("lotId", "version", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotEntrance" ADD CONSTRAINT "LotEntrance_lotId_version_floorId_fkey" FOREIGN KEY ("lotId", "version", "floorId") REFERENCES "LotFloor"("lotId", "version", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotEntrance" ADD CONSTRAINT "LotEntrance_lotId_version_floorId_zoneId_fkey" FOREIGN KEY ("lotId", "version", "floorId", "zoneId") REFERENCES "LotZone"("lotId", "version", "floorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotRamp" ADD CONSTRAINT "LotRamp_lotId_version_fromFloorId_fkey" FOREIGN KEY ("lotId", "version", "fromFloorId") REFERENCES "LotFloor"("lotId", "version", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotRamp" ADD CONSTRAINT "LotRamp_lotId_version_toFloorId_fkey" FOREIGN KEY ("lotId", "version", "toFloorId") REFERENCES "LotFloor"("lotId", "version", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotRamp" ADD CONSTRAINT "LotRamp_lotId_version_fromFloorId_fromZoneId_fkey" FOREIGN KEY ("lotId", "version", "fromFloorId", "fromZoneId") REFERENCES "LotZone"("lotId", "version", "floorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotRamp" ADD CONSTRAINT "LotRamp_lotId_version_toFloorId_toZoneId_fkey" FOREIGN KEY ("lotId", "version", "toFloorId", "toZoneId") REFERENCES "LotZone"("lotId", "version", "floorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotMutation" ADD CONSTRAINT "LotMutation_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
