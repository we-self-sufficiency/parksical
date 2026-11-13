import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsString, IsUrl, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';

export class PointDto {
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(-10000) @Max(10000) x!: number;
  @IsNumber({ maxDecimalPlaces: 3 }) @Min(-10000) @Max(10000) y!: number;
}
export class FloorDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @IsString() @MinLength(1) @MaxLength(64) label!: string;
  @ValidateIf(o => o.level !== null) @IsInt() @Min(-30) @Max(200) level!: number | null;
}
export class ZoneDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId!: string;
  @IsString() @MinLength(1) @MaxLength(64) label!: string;
  @ValidateIf(o => o.polygon !== null) @IsArray() @ArrayMinSize(4) @ArrayMaxSize(65) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => PointDto) polygon!: PointDto[] | null;
}
export class EntranceDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId!: string;
  @ValidateIf(o => o.zoneId !== null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) zoneId!: string | null;
  @IsIn(['ENTRY', 'EXIT', 'BOTH', 'UNKNOWN']) direction!: string;
  @ValidateIf(o => o.point !== null) @IsObject() @ValidateNested() @Type(() => PointDto) point!: PointDto | null;
}
export class RampDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) fromFloorId!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) toFloorId!: string;
  @ValidateIf(o => o.fromZoneId !== null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) fromZoneId!: string | null;
  @ValidateIf(o => o.toZoneId !== null) @Matches(/^[A-Za-z0-9_-]{1,32}$/) toZoneId!: string | null;
  @IsIn(['ONE_WAY', 'TWO_WAY', 'UNKNOWN']) direction!: string;
  @ValidateIf(o => o.widthMm !== null) @IsInt() @Min(500) @Max(30000) widthMm!: number | null;
  @ValidateIf(o => o.slopePercent !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) slopePercent!: number | null;
}
export class SpaceApproachDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) aisleId!: string;
  @IsIn(['FRONT', 'REAR']) side!: 'FRONT' | 'REAR';
  @IsInt() @Min(1000) @Max(20000) depthMm!: number;
  @IsInt() @Min(0) @Max(3000) lateralClearanceMm!: number;
}
export class DriveAisleDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) zoneId!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => PointDto) center!: PointDto;
  @IsInt() @Min(1000) @Max(20000) widthMm!: number;
  @IsInt() @Min(1000) @Max(100000) lengthMm!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(359.99) headingDegrees!: number;
  @IsIn(['TWO_WAY', 'ONE_WAY']) direction!: string;
}
export class ParkingSpaceDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) zoneId!: string;
  @IsString() @MinLength(1) @MaxLength(32) label!: string;
  @IsIn(['GENERAL', 'ACCESSIBLE', 'EV', 'COMPACT', 'UNKNOWN']) type!: string;
  @IsBoolean() active!: boolean;
  @ValidateIf(o => o.center !== null) @IsObject() @ValidateNested() @Type(() => PointDto) center!: PointDto | null;
  @ValidateIf(o => o.widthMm !== null) @IsInt() @Min(1000) @Max(10000) widthMm!: number | null;
  @ValidateIf(o => o.lengthMm !== null) @IsInt() @Min(1000) @Max(20000) lengthMm!: number | null;
  @ValidateIf(o => o.headingDegrees !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(359.99) headingDegrees!: number | null;
  @ValidateIf(o => o.approach !== undefined && o.approach !== null) @IsObject() @ValidateNested() @Type(() => SpaceApproachDto) approach?: SpaceApproachDto | null;
}
export class PillarDto {
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) id!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) floorId!: string;
  @Matches(/^[A-Za-z0-9_-]{1,32}$/) zoneId!: string;
  @ValidateIf(o => o.center !== null) @IsObject() @ValidateNested() @Type(() => PointDto) center!: PointDto | null;
  @ValidateIf(o => o.widthMm !== null) @IsInt() @Min(100) @Max(10000) widthMm!: number | null;
  @ValidateIf(o => o.depthMm !== null) @IsInt() @Min(100) @Max(10000) depthMm!: number | null;
  @ValidateIf(o => o.rotationDegrees !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(359.99) rotationDegrees!: number | null;
  @ValidateIf(o => o.islandWidthMm !== undefined && o.islandWidthMm !== null) @IsInt() @Min(100) @Max(10000) islandWidthMm?: number | null;
  @ValidateIf(o => o.islandDepthMm !== undefined && o.islandDepthMm !== null) @IsInt() @Min(100) @Max(20000) islandDepthMm?: number | null;
}
export class HoursDto {
  @IsInt() @Min(1) @Max(7) day!: number;
  @IsInt() @Min(0) @Max(1439) openMinute!: number;
  @IsInt() @Min(1) @Max(1440) closeMinute!: number;
}
export class FeesDto {
  @IsIn(['KRW']) currency!: 'KRW';
  @IsInt() @Min(1) @Max(1440) baseMinutes!: number;
  @IsInt() @Min(0) @Max(10000000) baseAmount!: number;
  @IsInt() @Min(1) @Max(1440) additionalMinutes!: number;
  @IsInt() @Min(0) @Max(10000000) additionalAmount!: number;
  @ValidateIf(o => o.dailyMaxAmount !== null) @IsInt() @Min(0) @Max(10000000) dailyMaxAmount!: number | null;
}
export class ScoresDto {
  @ValidateIf(o => o.structure !== null) @IsNumber() @Min(1) @Max(5) structure!: number | null;
  @ValidateIf(o => o.review !== null) @IsNumber() @Min(1) @Max(5) review!: number | null;
  @ValidateIf(o => o.driving !== null) @IsNumber() @Min(1) @Max(5) driving!: number | null;
  @ValidateIf(o => o.age !== null) @IsNumber() @Min(1) @Max(5) age!: number | null;
}
export class PhotoDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(1000) url!: string;
  @IsString() @MinLength(1) @MaxLength(200) caption!: string;
  @IsString() @MinLength(1) @MaxLength(500) rightsNote!: string;
}
export class LotSnapshotDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(1) @MaxLength(240) address!: string;
  @IsBoolean() active!: boolean;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsIn(['PUBLIC', 'PRIVATE', 'UNKNOWN']) ownership!: string;
  @IsIn(['SELF_PARK', 'MECHANICAL', 'MIXED', 'UNKNOWN']) parkingType!: string;
  @IsBoolean() partnered!: boolean;
  @ValidateIf(o => o.builtYear !== null) @IsInt() @Min(1800) @Max(2200) builtYear!: number | null;
  // REAL ingestion requires a separate rights/source review, not a client label.
  @IsIn(['SYNTHETIC']) source!: 'SYNTHETIC';
  @IsString() @MinLength(1) @MaxLength(500) sourceReference!: string;
  @IsString() @MinLength(1) @MaxLength(500) rightsNote!: string;
  @IsISO8601({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/) sourceUpdatedAt!: string;
  @IsIn(['UNKNOWN', 'DRAFT', 'COMPLETE']) structureStatus!: string;
  @IsIn(['LOCAL_METERS']) geometrySystem!: 'LOCAL_METERS';
  @IsIn(['Asia/Seoul']) timezone!: 'Asia/Seoul';
  // null = unknown, [] = all days closed. Overnight opening must be split by day.
  @ValidateIf(o => o.operatingHours !== null) @IsArray() @ArrayMaxSize(28) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => HoursDto) operatingHours!: HoursDto[] | null;
  @ValidateIf(o => o.fees !== null) @IsObject() @ValidateNested() @Type(() => FeesDto) fees!: FeesDto | null;
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(40, { each: true }) tags!: string[];
  @IsArray() @ArrayMaxSize(10) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => PhotoDto) photos!: PhotoDto[];
  @IsDefined() @IsObject() @ValidateNested() @Type(() => ScoresDto) factorScores!: ScoresDto;
  @IsIn([false]) challengeAllowed!: false;
  @IsArray() @ArrayMaxSize(50) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => FloorDto) floors!: FloorDto[];
  @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ZoneDto) zones!: ZoneDto[];
  @IsArray() @ArrayMaxSize(30) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => EntranceDto) entrances!: EntranceDto[];
  @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => RampDto) ramps!: RampDto[];
  // Omitted = not mapped. [] = mapped, none. COMPLETE requires explicit arrays and at least one space.
  @ValidateIf(o => o.parkingSpaces !== undefined) @IsArray() @ArrayMaxSize(200) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => ParkingSpaceDto) parkingSpaces?: ParkingSpaceDto[];
  @ValidateIf(o => o.pillars !== undefined) @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => PillarDto) pillars?: PillarDto[];
  @ValidateIf(o => o.driveAisles !== undefined) @IsArray() @ArrayMaxSize(50) @IsObject({ each: true }) @ValidateNested({ each: true }) @Type(() => DriveAisleDto) driveAisles?: DriveAisleDto[];
}
export class LotCreateDto {
  @Matches(/^[a-z0-9][a-z0-9_-]{0,63}$/) code!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => LotSnapshotDto) snapshot!: LotSnapshotDto;
}
export class LotReplaceDto {
  @IsInt() @Min(1) @Max(2147483646) expectedVersion!: number;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => LotSnapshotDto) snapshot!: LotSnapshotDto;
}
export class LotListQuery {
  @ValidateIf(o => o.after !== undefined) @IsUUID() after?: string;
}
