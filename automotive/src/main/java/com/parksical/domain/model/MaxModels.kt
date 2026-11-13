package com.parksical.domain.model

enum class RunMode { CHALLENGE, PRACTICE }

enum class MissionType(val title: String, val rule: String) {
    SPIRAL_NO_STOP("나선 경사로 무정지 통과", "경사로 구간에서 정지 0회 · 속도·브레이크로 판정"),
    PILLAR_SMOOTH("기둥 숲 부드럽게 통과", "10km/h 이하 유지 · 급조향·급제동 없이"),
    REVERSE_PARK_ONE_SHOT("한 번에 후진 주차", "지정 면에 기어 전환 2회 이내로 P단 체결"),
}

data class Stage(
    val index: Int,
    val label: String,
    val floor: String,
    val mission: MissionType,
    /**
     * Distance the stage lasts, measured by integrating speed. The last stage ignores it and
     * ends when the gear goes to P (underground has no GPS, so distance is the only progress signal).
     */
    val lengthM: Float,
)

data class Dungeon(
    val lotId: String,
    val name: String,
    val stars: Int,
    val timeLimitSec: Int,
    val stages: List<Stage>,
    /** Fee multiplier vs. normal parking fee. */
    val challengeMultiplier: Float,
    val practiceMultiplier: Float,
    val openSlots: List<String>,
)

data class StageResult(
    val stageIndex: Int,
    val mission: MissionType,
    val stars: Int,
    /** One line for the result card, e.g. "경사로 정지 0회 · 최고 속도 8km/h". */
    val summary: String,
    val passed: Boolean,
)

/** Point of the replay trace, used for the practice report pixel map. */
data class TracePoint(
    val tMs: Long,
    val distanceM: Float,
    val speedKmh: Float,
    val steeringDeg: Float,
    val gear: com.parksical.vehicle.Gear,
)

enum class TraceEventType { GEAR_CHANGE, SHARP_STEER, HARD_BRAKE, STOP }

data class TraceEvent(val tMs: Long, val distanceM: Float, val type: TraceEventType)

data class RunRecord(
    val lotId: String,
    val mode: RunMode,
    val startedAtMs: Long,
    val durationMs: Long,
    val gearShifts: Int,
    val stageResults: List<StageResult>,
    val trace: List<TracePoint>,
    val events: List<TraceEvent>,
    /** True only when the last stage ended with P in time (not aborted, not timed out). */
    val cleared: Boolean = false,
) {
    val totalStars: Int get() = stageResults.sumOf { it.stars }
}

sealed interface RunStatus {
    data object Idle : RunStatus
    data class Running(
        val stageIndex: Int,
        val elapsedMs: Long,
        val remainingMs: Long,
        /** Short live text for the HUD, e.g. "기둥 숲 무경고 통과". */
        val hudText: String,
    ) : RunStatus
    data class Aborted(val reason: String, val partial: RunRecord) : RunStatus
    data class Finished(val record: RunRecord) : RunStatus
}

enum class Title(val label: String, val minStamps: Int) {
    BEGINNER("초보", 0), SKILLED("숙련", 5), MASTER("고수", 10), LEGEND("달인", 20);

    companion object {
        fun of(stamps: Int) = entries.last { stamps >= it.minStamps }
    }
}

data class Reservation(
    val lotId: String,
    val mode: RunMode,
    val slot: String,
    val minutes: Int,
    val paidWon: Int,
)
