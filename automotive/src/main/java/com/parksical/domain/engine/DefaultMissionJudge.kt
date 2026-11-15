package com.parksical.domain.engine

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.MissionType
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunOutcome
import com.parksical.domain.model.RunReason
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.RunStatus
import com.parksical.domain.model.SignalQuality
import com.parksical.domain.model.StageMetrics
import com.parksical.domain.model.StageOutcome
import com.parksical.domain.model.StageReport
import com.parksical.domain.model.StageResult
import com.parksical.domain.model.TraceEvent
import com.parksical.domain.model.TraceEventType
import com.parksical.domain.model.TracePoint
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.roundToLong

/**
 * Judges by the parksical-server `missions-v1` rules, so a result is something the server accepts.
 * Time base is [VehicleState.timestampMs]. Judging starts when the gear first leaves P; before that status is
 * Running(stageIndex 0, elapsed 0, full remaining time). Server offsets are relative to the `start()` time.
 * Every [VehicleState] emission counts as one observation of each supported signal; nothing is interpolated.
 * In PRACTICE remainingMs is 0 (no limit).
 */
class DefaultMissionJudge : MissionJudge {
    private val _status = MutableStateFlow<RunStatus>(RunStatus.Idle)
    override val status: StateFlow<RunStatus> = _status

    private enum class Cause { FINISHED, CANCELLED, TIME_LIMIT }

    /** Everything collected for the stage in progress. */
    private class Acc(s: VehicleState) {
        val firstTs = s.timestampMs
        var lastTs = s.timestampMs
        var n = 0
        var maxGap = 0L
        var movingMs = 0L
        var maxSpeed = 0f
        var transitions = 0
        var stops = 0
        var sharps = 0
        var reverses = 0
        var danger = 0
        var stoppedMs = 0L
        var stopCounted = false
        var prevGear: Gear? = null
        var parked = false

        fun add(s: VehicleState, gapMs: Long) {
            n++
            if (n > 1) maxGap = maxOf(maxGap, gapMs)
            lastTs = s.timestampMs
            maxSpeed = maxOf(maxSpeed, abs(s.speedKmh))
            val p = prevGear
            if (p != null && p != s.gear) transitions++
            if (s.gear == Gear.REVERSE && p != Gear.REVERSE) reverses++
            prevGear = s.gear
        }
    }

    private var dungeon: Dungeon? = null
    private var mode = RunMode.PRACTICE
    private var caps = VehicleCapabilities()
    private var originMs = 0L

    private var begun = false
    private var done = false
    private var t0 = 0L
    private var lastTs = 0L
    private var lastObsTs = 0L
    private var last = VehicleState()
    private var lastTraceMs = Long.MIN_VALUE

    private var distanceM = 0f
    private var stage = 0
    private var stageStartM = 0f
    private var sharpActive = false
    private var brakeActive = false
    private var totalShifts = 0
    private var acc: Acc? = null

    private val results = mutableListOf<StageResult>()
    private val trace = mutableListOf<TracePoint>()
    private val recent = ArrayDeque<VehicleState>()
    private val events = mutableListOf<TraceEvent>()

    override fun start(dungeon: Dungeon, mode: RunMode, capabilities: VehicleCapabilities, nowMs: Long) {
        reset()
        this.dungeon = dungeon
        this.mode = mode
        caps = capabilities
        originMs = nowMs
        lastObsTs = nowMs
        _status.value = running(0)
    }

    override fun reset() {
        dungeon = null; begun = false; done = false; distanceM = 0f; stage = 0; stageStartM = 0f
        sharpActive = false; brakeActive = false; acc = null
        totalShifts = 0; lastTraceMs = Long.MIN_VALUE; last = VehicleState()
        results.clear(); trace.clear(); events.clear(); recent.clear()
        _status.value = RunStatus.Idle
    }

    override fun cancel() {
        val d = dungeon ?: return
        if (done) return
        if (acc == null) {
            end(d, RunOutcome.ABORTED, RunReason.USER_CANCELLED, null, 0L)
        } else closeStage(d, Cause.CANCELLED, null)
    }

    override fun onSample(s: VehicleState) {
        val d = dungeon ?: return
        if (done) return
        val danger = s.airbagDeployed || (s.doorOpen && s.gear != Gear.PARK) // opening a door in P is normal
        if (!begun) {
            if (danger) {
                // shortcut: no stage span yet, so the server cannot represent this; the run stays local-only
                end(d, RunOutcome.ABORTED, RunReason.DANGER_EVENT, dangerText(s), 0L)
                return
            }
            if (s.gear == Gear.PARK) return
            begun = true; t0 = s.timestampMs; lastTs = s.timestampMs; lastObsTs = s.timestampMs; last = s; recent.addLast(s)
            acc = Acc(s).also { it.add(s, 0) }
            record(s)
            _status.value = running(0)
            if (abs(s.speedKmh) > ABORT_KMH) closeStage(d, Cause.FINISHED, s) // single-sample stage: reported locally only
            return
        }
        val a = acc!!
        val rawDt = s.timestampMs - lastTs
        if (rawDt <= 0) return // duplicate or out-of-order
        val dt = rawDt.coerceAtMost(MAX_DT_MS)
        val dtSec = dt / 1000f
        lastTs = s.timestampMs
        lastObsTs = s.timestampMs
        a.add(s, rawDt)
        if (abs(s.speedKmh) >= STOP_KMH) a.movingMs += rawDt // attributed by the interval's end sample

        distanceM += (abs(last.speedKmh) + abs(s.speedKmh)) / 2f / 3.6f * dtSec
        val atM = distanceM

        if (s.gear != last.gear) {
            event(s, TraceEventType.GEAR_CHANGE)
            if (s.gear != Gear.PARK && last.gear != Gear.PARK) totalShifts++
        }
        // Speed and steering arrive as separate events ms apart, so rates use the newest sample >= RATE_WINDOW_MS old.
        recent.addLast(s)
        while (recent.size > 1 && s.timestampMs - recent[1].timestampMs >= RATE_WINDOW_MS) recent.removeFirst()
        val ref = recent.first()
        val win = s.timestampMs - ref.timestampMs
        val winSec = win / 1000f
        // Edge-triggered so one sustained maneuver counts once.
        val sharp = win in RATE_WINDOW_MS..MAX_DT_MS && abs(s.steeringDeg - ref.steeringDeg) / winSec > SHARP_DEG_PER_SEC
        if (sharp && !sharpActive) { a.sharps++; event(s, TraceEventType.SHARP_STEER) }
        sharpActive = sharp
        // Trace only: hard braking no longer affects stars.
        val hard = s.gear != Gear.PARK && win >= RATE_WINDOW_MS && (ref.speedKmh - s.speedKmh) / winSec > HARD_BRAKE_KMH_PER_SEC
        if (hard && !brakeActive) event(s, TraceEventType.HARD_BRAKE)
        brakeActive = hard

        // A stop only counts once the car has actually moved (leaving P at 0 km/h is not a stop), in any gear.
        if (abs(s.speedKmh) < STOP_KMH && atM > 0.5f) {
            a.stoppedMs += dt
            if (a.stoppedMs >= STOP_MS && !a.stopCounted) {
                a.stopCounted = true
                event(s, TraceEventType.STOP)
                if (d.stages[stage].mission == MissionType.NO_STOP_RAMP) a.stops++
            }
        } else { a.stoppedMs = 0; a.stopCounted = false }

        if (danger) a.danger = 1
        record(s)
        last = s

        val elapsed = s.timestampMs - t0
        when {
            danger -> closeStage(d, Cause.FINISHED, s, dangerText(s))
            abs(s.speedKmh) > ABORT_KMH -> closeStage(d, Cause.FINISHED, s)
            rawDt > d.maxGapMs -> closeStage(d, Cause.FINISHED, s)
            a.stops > 0 -> closeStage(d, Cause.FINISHED, s)
            mode == RunMode.CHALLENGE && s.timestampMs - originMs > d.timeLimitSec * 1000L -> closeStage(d, Cause.TIME_LIMIT, s)
            stage == d.stages.lastIndex && s.gear == Gear.PARK && atM > 0.5f -> { a.parked = true; closeStage(d, Cause.FINISHED, s) }
            stage < d.stages.lastIndex && atM - stageStartM >= d.stages[stage].lengthM -> closeStage(d, Cause.FINISHED, s)
            else -> _status.value = running(elapsed)
        }
    }

    private fun dangerText(s: VehicleState) = if (s.airbagDeployed) "에어백이 전개되어 미션을 중단했어요" else "문이 열려 미션을 중단했어요"

    private fun running(elapsed: Long): RunStatus.Running {
        val d = dungeon!!
        val remaining = if (mode == RunMode.CHALLENGE) (d.timeLimitSec * 1000L - elapsed).coerceAtLeast(0) else 0L
        return RunStatus.Running(stage, elapsed, remaining, d.stages[stage].mission.title)
    }

    /** Ends the stage in progress; moves on to the next one, or ends the run. [s] is the sample that ended it (null = cancel). */
    private fun closeStage(d: Dungeon, cause: Cause, s: VehicleState?, message: String? = null) {
        val a = acc!!
        val res = stageResult(d, a, cause)
        results += res
        when (res.outcome) {
            StageOutcome.SUCCESS, StageOutcome.FAILED ->
                if (stage == d.stages.lastIndex) end(d, RunOutcome.COMPLETED, RunReason.FINISHED, null, lastTs - t0)
                else {
                    stage++; stageStartM = distanceM
                    acc = Acc(s!!).also { it.add(s, 0) }
                    _status.value = running(s.timestampMs - t0)
                }
            else -> end(d, if (res.outcome == StageOutcome.ABORTED) RunOutcome.ABORTED else RunOutcome.UNVERIFIABLE, res.reason, message.takeIf { res.reason == RunReason.DANGER_EVENT }, lastTs - t0)
        }
    }

    private fun end(d: Dungeon, outcome: RunOutcome, reason: RunReason, message: String?, durationMs: Long) {
        done = true
        val all = results.toList() + d.stages.drop(results.size).map {
            StageResult(it.index, it.mission, 0, "진행하지 못했어요", false, it.stageId, StageOutcome.NOT_RUN, reason)
        }
        val rec = RunRecord(
            d.lotId, mode, originMs, durationMs, totalShifts, all, trace.toList(), events.toList(),
            cleared = outcome == RunOutcome.COMPLETED, outcome = outcome, reason = reason,
        )
        _status.value = if (outcome == RunOutcome.COMPLETED) RunStatus.Finished(rec) else RunStatus.Aborted(message ?: reason.ko, rec)
    }

    /** Mirrors the server's precedence (rules.ts validateStage) so what we report is what the server derives. */
    private fun stageResult(d: Dungeon, a: Acc, cause: Cause): StageResult {
        val st = d.stages[stage]
        val mission = st.mission
        val dur = a.lastTs - a.firstTs
        val quality = st.requiredQuality.map { sig ->
            val ok = when (sig) { "speed" -> caps.speed; "gear" -> caps.gear; "steeringAngle" -> caps.steering; else -> true }
            if (ok) SignalQuality(sig, "AVAILABLE", a.n, a.maxGap, dur) else SignalQuality(sig, "UNSUPPORTED", 0, null, 0)
        }
        fun usable(q: SignalQuality): Boolean {
            if (q.status != "AVAILABLE" || q.maxGapMs == null || q.maxGapMs > d.maxGapMs) return false
            if (q.signal != "speed" && q.signal != "steeringAngle") return q.validSampleCount >= 1
            return q.maxGapMs > 0 && q.validSampleCount >= 2 && q.validSampleCount >= ceil(dur.toDouble() / q.maxGapMs).toInt() + 1
        }
        val speedOk = quality.firstOrNull { it.signal == "speed" }?.status == "AVAILABLE"
        val allUsable = dur > 0 && quality.all(::usable)
        val maxSpeed = if (speedOk) (a.maxSpeed.toDouble() * 1000).roundToLong() / 1000.0 else null
        val count = when (mission) { MissionType.NO_STOP_RAMP -> a.stops; MissionType.SMOOTH_STEERING -> a.sharps; MissionType.ONE_SHOT_REVERSE -> a.reverses }
        val parkingConfirmed = if (mission == MissionType.ONE_SHOT_REVERSE) a.parked else null
        // A ramp stage without a stop was moving the whole time (dips under 1 s are not stops); the server requires moving == duration.
        val moving = if (mission == MissionType.NO_STOP_RAMP && a.stops == 0) dur else a.movingMs.coerceAtMost(dur)
        val stars = when (mission) {
            MissionType.NO_STOP_RAMP -> 3
            MissionType.SMOOTH_STEERING -> (3 - a.sharps).coerceAtLeast(0)
            MissionType.ONE_SHOT_REVERSE -> if (a.reverses == 1) 3 else 0
        }
        val speedUsable = quality.firstOrNull { it.signal == "speed" }?.let(::usable) == true
        val riskUsable = quality.firstOrNull { it.signal == "riskEvents" }?.let(::usable) == true
        val (outcome, reason) = when {
            speedUsable && maxSpeed != null && maxSpeed > ABORT_KMH -> StageOutcome.ABORTED to RunReason.SPEED_LIMIT
            riskUsable && a.danger > 0 -> StageOutcome.ABORTED to RunReason.DANGER_EVENT
            !allUsable || maxSpeed == null -> StageOutcome.UNVERIFIABLE to RunReason.SIGNAL_QUALITY
            cause == Cause.CANCELLED -> StageOutcome.ABORTED to RunReason.USER_CANCELLED
            cause == Cause.TIME_LIMIT -> StageOutcome.ABORTED to RunReason.TIME_LIMIT
            mission == MissionType.NO_STOP_RAMP && a.stops > 0 -> StageOutcome.ABORTED to RunReason.STOPPED
            moving <= 0 || maxSpeed == 0.0 || (mission == MissionType.ONE_SHOT_REVERSE && (!a.parked || moving >= dur)) ->
                StageOutcome.UNVERIFIABLE to RunReason.SIGNAL_QUALITY
            stars > 0 -> StageOutcome.SUCCESS to RunReason.FINISHED
            else -> StageOutcome.FAILED to RunReason.FINISHED
        }
        val finished = outcome == StageOutcome.SUCCESS || outcome == StageOutcome.FAILED
        val metrics = StageMetrics(
            movingDurationMs = moving, maxSpeedKph = maxSpeed, dangerEventCount = a.danger,
            stopCount = if (mission == MissionType.NO_STOP_RAMP) a.stops else null,
            abruptSteeringCount = if (mission == MissionType.SMOOTH_STEERING) a.sharps else null,
            reverseSegmentCount = if (mission == MissionType.ONE_SHOT_REVERSE) a.reverses else null,
            gearTransitionCount = if (caps.gear) a.transitions else null,
        )
        val report = if (dur <= 0) null else StageReport(
            (a.firstTs - originMs).coerceAtLeast(0), a.lastTs - originMs, segmentEntered = true, segmentExited = finished,
            parkingConfirmed = parkingConfirmed, metrics = metrics, quality = quality,
        )
        val speedText = maxSpeed?.let { " · 최고 속도 ${it.toInt()}km/h" }.orEmpty()
        val summary = if (!finished) reason.ko else when (mission) {
            MissionType.NO_STOP_RAMP -> "경사로 정지 0회$speedText"
            MissionType.SMOOTH_STEERING -> "급조향 ${a.sharps}회$speedText"
            MissionType.ONE_SHOT_REVERSE -> "후진 진입 ${a.reverses}회 (목표 1회)"
        }
        return StageResult(st.index, mission, if (finished) stars else 0, summary, outcome == StageOutcome.SUCCESS, st.stageId, outcome, reason, report)
    }

    private fun record(s: VehicleState) {
        if (lastTraceMs != Long.MIN_VALUE && s.timestampMs - lastTraceMs < TRACE_MS) return
        lastTraceMs = s.timestampMs
        trace += TracePoint(s.timestampMs - t0, distanceM, s.speedKmh, s.steeringDeg, s.gear)
    }

    private fun event(s: VehicleState, type: TraceEventType) {
        events += TraceEvent(s.timestampMs - t0, distanceM, type)
    }

    private companion object {
        const val MAX_DT_MS = 2000L
        const val TRACE_MS = 200L
        const val RATE_WINDOW_MS = 200L
        const val STOP_KMH = 0.5f
        const val STOP_MS = 1000L
        const val SHARP_DEG_PER_SEC = 180f
        const val HARD_BRAKE_KMH_PER_SEC = 8f
        const val ABORT_KMH = 10f
    }
}
