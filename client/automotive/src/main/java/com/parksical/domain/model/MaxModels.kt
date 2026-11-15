package com.parksical.domain.model

enum class RunMode { CHALLENGE, PRACTICE }

/** Names match the server `missionCode`. */
enum class MissionType(val title: String, val rule: String, val requiredQuality: List<String>) {
    NO_STOP_RAMP("경사로 무정지 통과", "경사로에서 멈추면(P단 포함) 중단 · 10km/h 이하", listOf("speed", "gear", "segment", "riskEvents")),
    SMOOTH_STEERING("부드러운 조향", "10km/h 이하 · 급조향 1회당 별 1개 감점", listOf("speed", "gear", "segment", "riskEvents", "steeringAngle")),
    ONE_SHOT_REVERSE("한 번에 후진 주차", "후진(R) 진입 1회로 지정 면에 P단 체결", listOf("speed", "gear", "segment", "riskEvents")),
}

enum class RunOutcome { COMPLETED, ABORTED, UNVERIFIABLE }

/** NOT_RUN is local only (stage never reached); it is never sent to the server. */
enum class StageOutcome { SUCCESS, FAILED, ABORTED, UNVERIFIABLE, NOT_RUN }

/** Names match the server `reason`; [ko] is shown on the result screen. */
enum class RunReason(val ko: String) {
    FINISHED("모든 스테이지를 마쳤어요"),
    SPEED_LIMIT("저속 상한 초과로 미션이 중단됐어요"),
    DANGER_EVENT("위험 이벤트로 미션이 중단됐어요"),
    UX_RESTRICTED("화면 제한으로 미션이 중단됐어요"),
    UX_UNKNOWN("화면 제한 상태를 알 수 없어 판정할 수 없어요"),
    SIGNAL_QUALITY("차량 신호가 부족해 판정할 수 없어요"),
    USER_CANCELLED("도전을 포기했어요"),
    APP_RESTARTED("앱이 다시 시작되어 판정할 수 없어요"),
    TIME_LIMIT("제한 시간을 넘어 미션이 중단됐어요"),
    STOPPED("경사로에서 멈춰 미션이 중단됐어요"),
}

/** Where a finished run stands with the server. */
enum class SubmitState(val ko: String) {
    NOT_SUBMITTED("서버 미제출"), PENDING("서버 제출 중"), SUBMITTED("서버 제출 완료"), MOCK("목업 · 서버 제출 안 함")
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
    /** Server stage id, e.g. "NO_STOP_RAMP:ramp-b1". */
    val stageId: String = "",
    val requiredQuality: List<String> = mission.requiredQuality,
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
    /** Empty for server dungeons: the server has no reservation/slot API yet (S-14). */
    val openSlots: List<String>,
    val ruleVersion: String = "",
    val structureVersion: Int = 0,
    /** Server rule `maxGapMs`: longest allowed gap between samples inside a stage. */
    val maxGapMs: Long = 1000,
)

data class StageMetrics(
    val movingDurationMs: Long?,
    val maxSpeedKph: Double?,
    val dangerEventCount: Int,
    val stopCount: Int? = null,
    val abruptSteeringCount: Int? = null,
    val reverseSegmentCount: Int? = null,
    val gearTransitionCount: Int? = null,
)

/** [signal] and [status] use the server enum names. */
data class SignalQuality(val signal: String, val status: String, val validSampleCount: Int, val maxGapMs: Long?, val coveredMs: Long)

/** What the server wants per stage; null on [StageResult] when the stage has no reportable span. */
data class StageReport(
    val startOffsetMs: Long,
    val endOffsetMs: Long,
    val segmentEntered: Boolean,
    val segmentExited: Boolean,
    val parkingConfirmed: Boolean?,
    val metrics: StageMetrics,
    val quality: List<SignalQuality>,
)

data class StageResult(
    val stageIndex: Int,
    val mission: MissionType,
    val stars: Int,
    /** One line for the result card, e.g. "경사로 정지 0회 · 최고 속도 8km/h". */
    val summary: String,
    val passed: Boolean,
    val stageId: String = "",
    val outcome: StageOutcome = StageOutcome.SUCCESS,
    val reason: RunReason = RunReason.FINISHED,
    val report: StageReport? = null,
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
    val outcome: RunOutcome = RunOutcome.COMPLETED,
    val reason: RunReason = RunReason.FINISHED,
    /** Idempotency anchor for the server; filled by DriveCoordinator (the judge is pure). */
    val clientRunId: String = "",
    /** Wall clock at run start; [startedAtMs] is the monotonic origin used for durations. */
    val startedAtEpochMs: Long = 0,
    val serverRunId: String? = null,
    val submit: SubmitState = SubmitState.NOT_SUBMITTED,
    /** Server receipt outcome, e.g. "COMPLETED". */
    val receiptOutcome: String? = null,
) {
    /** The server scores only completed runs; an aborted/unverifiable run is 0 (stage cards keep their own stars). */
    val totalStars: Int get() = if (outcome == RunOutcome.COMPLETED) stageResults.sumOf { it.stars } else 0
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
    val reservationId: String? = null,
)
