-- CreateTable
CREATE TABLE "ParkingSpace" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "floorId" VARCHAR(32) NOT NULL,
    "zoneId" VARCHAR(32) NOT NULL,
    "label" VARCHAR(32) NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "ParkingSpace_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateTable
CREATE TABLE "LotPillar" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "floorId" VARCHAR(32) NOT NULL,
    "zoneId" VARCHAR(32) NOT NULL,

    CONSTRAINT "LotPillar_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ParkingSpace_lotId_version_floorId_label_key" ON "ParkingSpace"("lotId", "version", "floorId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "ParkingSpace_lotId_version_floorId_zoneId_id_key" ON "ParkingSpace"("lotId", "version", "floorId", "zoneId", "id");

-- AddForeignKey
ALTER TABLE "ParkingSpace" ADD CONSTRAINT "ParkingSpace_lotId_version_floorId_zoneId_fkey" FOREIGN KEY ("lotId", "version", "floorId", "zoneId") REFERENCES "LotZone"("lotId", "version", "floorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotPillar" ADD CONSTRAINT "LotPillar_lotId_version_floorId_zoneId_fkey" FOREIGN KEY ("lotId", "version", "floorId", "zoneId") REFERENCES "LotZone"("lotId", "version", "floorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
