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

data class ParkingLot(
    val id: String,
    val name: String,
    val subtitle: String,
    val lat: Double,
    val lng: Double,
    val walkMinutes: Int,
    val fee30MinWon: Int,
    val hours: String,
    val builtYear: Int,
    val isPublic: Boolean,
    val isPartner: Boolean,
    val prepayDiscountPercent: Int,
    val tags: List<String>,
    val structure: LotStructure,
    /** User review difficulty, 1..5 (25% factor). */
    val reviewDifficulty: Float,
    val reviewCount: Int,
    /** Aggregated driving data (20% factor). */
    val avgGearShifts: Float,
    val avgParkSeconds: Int,
    val layout: LotLayout? = null,
    /** "도전장": partner lot with MAX challenge hours open. */
    val challengeOpen: Boolean = false,
    val challengeHours: String? = null,
)

/** Result of the difficulty index. All scores are 1..5 stars, higher = harder. */
data class DifficultyBreakdown(
    val structure: Float,
    val review: Float,
    val driving: Float,
    val age: Float,
    /** Weighted 40/25/20/15 before the car-size correction. */
    val base: Float,
    /** Final "내 차 기준" score, rounded to 0.5. */
    val forMyCar: Float,
    val size: VehicleSize,
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

/** Estimated parking spot shown after P is engaged. */
data class ParkingSpotEstimate(
    val lotId: String,
    val floor: String,
    val zone: String,
    /** 0..1; shown so the user knows it is an estimate. */
    val confidence: Float,
    val savedAtMs: Long,
    val memo: String? = null,
) {
    val label: String get() = "$floor · ${zone}구역 부근"
}
