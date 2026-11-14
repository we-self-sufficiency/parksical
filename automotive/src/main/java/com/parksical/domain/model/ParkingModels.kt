package com.parksical.domain.model

enum class VehicleSize(val label: String) {
    COMPACT("경차·소형"),
    MIDSIZE("중형 세단"),
    LARGE_SEDAN("대형 세단"),
    SUV("대형 SUV");
}

enum class RampType { FLAT, STRAIGHT, SPIRAL, MECHANICAL }

/** Physical structure of a lot, the 40% "구조" factor. */
data class LotStructure(
    val entranceWidthM: Float,
    val rampType: RampType,
    /** Full spiral turns between two floors (0 when not spiral). */
    val rampTurnsPerFloor: Float,
    /** 0..1, how dense pillars are. */
    val pillarDensity: Float,
    val bayWidthM: Float,
    /** Largest car this lot accepts, null = no limit (mechanical towers often reject SUVs). */
    val maxSize: VehicleSize? = null,
)

/** Floor/zone layout used to estimate where the car was parked. Only partner lots have one. */
data class LotLayout(
    val floors: List<FloorLayout>,
    /** Distance driven from the entrance until the first ramp starts. */
    val entranceToRampM: Float,
)

data class FloorLayout(
    val label: String,
    /** Zones in driving order on this floor, e.g. A, B, C, D. */
    val zones: List<String>,
    /** Distance driven along the floor's lane from the ramp exit to the last zone. */
    val laneLengthM: Float,
)

/**
 * A lot as the app shows it. Fields the server contract (parksical-server docs/openapi.json, `Lot`/`LotDetail`)
 * does not provide are nullable: null means "unknown", never 0. UI must show "정보 없음" instead of inventing values.
 */
data class ParkingLot(
    val id: String,
    val name: String,
    val subtitle: String? = null,
    val lat: Double,
    val lng: Double,
    val walkMinutes: Int? = null,
    val fee30MinWon: Int? = null,
    val hours: String? = null,
    val builtYear: Int? = null,
    val isPublic: Boolean? = null,
    val isPartner: Boolean,
    val prepayDiscountPercent: Int = 0,
    val tags: List<String> = emptyList(),
    val structure: LotStructure? = null,
    /** User review difficulty, 1..5 (25% factor). */
    val reviewDifficulty: Float? = null,
    val reviewCount: Int = 0,
    /** Aggregated driving data (20% factor). */
    val avgGearShifts: Float? = null,
    val avgParkSeconds: Int? = null,
    /** Lane lengths for local spot estimation. Only the mock partner lot has one. */
    val layout: LotLayout? = null,
    /** "도전장": partner lot with MAX challenge hours open. */
    val challengeOpen: Boolean = false,
    val challengeHours: String? = null,
    // ---- server contract fields ----
    val source: LotSource = LotSource.MOCK,
    /** Server marks seed/demo data; UI shows a "합성 데이터" tag. */
    val synthetic: Boolean = false,
    /** Great-circle distance from the search point (server `distanceM`). */
    val distanceM: Float? = null,
    /** Score computed by the server; when present the UI shows it instead of the local calculator. */
    val serverDifficulty: ServerDifficulty? = null,
    /** From `GET /lots/{id}`: floor/zone ids used when uploading a parked location. */
    val serverStructure: ServerStructure? = null,
    val navigationLat: Double? = null,
    val navigationLng: Double? = null,
)

enum class LotSource { SERVER, MOCK }

data class ServerDifficulty(
    /** Null = INSUFFICIENT_DATA. */
    val score: Float?,
    /** vehicle.basis == PROVIDED_DIMENSIONS (car size was sent) vs REFERENCE_DEFAULT. */
    val vehicleAdjusted: Boolean,
    val ruleVersion: String,
    val missingFactors: List<DifficultyFactor>,
    val sampleCount: Int,
    /** From `GET /lots/{id}` factors (INCLUDED only); empty for list items. */
    val factorScores: Map<DifficultyFactor, Float?> = emptyMap(),
)

enum class DifficultyFactor(val label: String) {
    STRUCTURE("주차장 구조"), REVIEW("이용자 리뷰"), DRIVING_STATS("주행 데이터 집계"), BUILDING_AGE("건물 연식")
}

data class ServerStructure(val version: String, val floors: List<ServerFloor>)

data class ServerFloor(val id: String, val label: String, val level: Int?, val zones: List<ServerZone>)

data class ServerZone(val id: String, val label: String)

/** Result of the difficulty index. All scores are 1..5 stars, higher = harder. Null factor = unknown input. */
data class DifficultyBreakdown(
    val structure: Float?,
    val review: Float?,
    val driving: Float?,
    val age: Float?,
    /** Weighted 40/25/20/15 over known factors (weights renormalised) before the car-size correction. */
    val base: Float,
    /** Final "내 차 기준" score, rounded to 0.5. */
    val forMyCar: Float,
    val size: VehicleSize,
    val missing: List<DifficultyFactor> = emptyList(),
    /** True when [forMyCar] came from the server (`ServerDifficulty`), factor bars are then unknown. */
    val fromServer: Boolean = false,
    /** Server answered INSUFFICIENT_DATA: [forMyCar] is meaningless, UI shows "정보 부족". */
    val insufficient: Boolean = false,
) {
    val level: DifficultyLevel get() = DifficultyLevel.of(forMyCar)
}

enum class DifficultyLevel(val label: String) {
    EASY("쉬움"), NORMAL("보통"), HARD("어려움");

    companion object {
        fun of(stars: Float) = when {
            stars < 2.75f -> EASY
            stars < 3.75f -> NORMAL
            else -> HARD
        }
    }
}

enum class SyncState { LOCAL_ONLY, SYNCING, SYNCED, FAILED }

/** Estimated parking spot shown after P is engaged. */
data class ParkingSpotEstimate(
    val lotId: String,
    val floor: String,
    val zone: String,
    /** 0..1; shown so the user knows it is an estimate. */
    val confidence: Float,
    val savedAtMs: Long,
    val memo: String? = null,
    /** Local record id = server `clientRecordId` (stable across re-sends). */
    val clientRecordId: String = "spot_" + savedAtMs,
    /** Wall-clock time of P engagement, for server `occurredAt` (RFC3339 UTC). */
    val occurredAtEpochMs: Long = System.currentTimeMillis(),
    val userEdited: Boolean = false,
    /** Server `Location.id` / `version` once uploaded. */
    val serverId: String? = null,
    val serverVersion: Int? = null,
    val sync: SyncState = SyncState.LOCAL_ONLY,
) {
    val label: String get() = "$floor · ${zone}구역 부근"
}
