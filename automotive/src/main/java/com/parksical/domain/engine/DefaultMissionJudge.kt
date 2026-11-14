package com.parksical.domain.engine

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.MissionType
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.RunStatus
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

/**
 * Time base is [VehicleState.timestampMs]. Judging (and the timer) starts when the gear first leaves P;
 * before that status is Running(stageIndex 0, elapsed 0, full remaining time). stageIndex is the 0-based
 * position in [Dungeon.stages]. In PRACTICE remainingMs is 0 (no limit).
 */
class DefaultMissionJudge : MissionJudge {
    private val _status = MutableStateFlow<RunStatus>(RunStatus.Idle)
    override val status: StateFlow<RunStatus> = _status

    private var dungeon: Dungeon? = null
    private var mode = RunMode.PRACTICE
    private var caps = VehicleCapabilities()
    private var startedAtMs = 0L

    private var begun = false
    private var done = false
    private var t0 = 0L
    private var lastTs = 0L
    private var last = VehicleState()
    private var lastTraceMs = Long.MIN_VALUE

    private var distanceM = 0f
    private var stage = 0
    private var stageStartM = 0f
    private var overMs = 0L
    private var stoppedMs = 0L
    private var stopCounted = false
    private var sharpActive = false
    private var brakeActive = false

    // per-stage counters
    private var stops = 0
    private var sharps = 0
    private var hardBrakes = 0
    private var gearShifts = 0
    private var maxSpeed = 0f
    private var totalShifts = 0

    private val results = mutableListOf<StageResult>()
    private val trace = mutableListOf<TracePoint>()
    private val recent = ArrayDeque<VehicleState>()
    private val events = mutableListOf<TraceEvent>()

    override fun start(dungeon: Dungeon, mode: RunMode, capabilities: VehicleCapabilities, nowMs: Long) {
        reset()
        this.dungeon = dungeon
        this.mode = mode
        caps = capabilities
        startedAtMs = nowMs
        _status.value = running(0)
    }

    override fun reset() {
        dungeon = null; begun = false; done = false; distanceM = 0f; stage = 0; stageStartM = 0f
        overMs = 0; stoppedMs = 0; stopCounted = false; sharpActive = false; brakeActive = false
        totalShifts = 0; lastTraceMs = Long.MIN_VALUE; last = VehicleState()
        results.clear(); trace.clear(); events.clear(); recent.clear(); resetStageCounters()
        _status.value = RunStatus.Idle
    }

    override fun onSample(s: VehicleState) {
        val d = dungeon ?: return
        if (done) return
        if (s.airbagDeployed) {
            done = true
            val elapsed = if (begun) s.timestampMs - t0 else 0L
            _status.value = RunStatus.Aborted("에어백이 전개되어 미션을 중단했어요", buildRecord(d, elapsed, "중단"))
            return
        }
        // Opening while in P is normal (loading, getting out); only an opening while out of P aborts.
        if (s.doorOpen && s.gear != Gear.PARK) {
            done = true
            val elapsed = if (begun) s.timestampMs - t0 else 0L
            _status.value = RunStatus.Aborted("문이 열려 미션을 중단했어요", buildRecord(d, elapsed, "중단"))
            return
        }
        if (!begun) {
            if (s.gear == Gear.PARK) return
            begun = true; t0 = s.timestampMs; lastTs = s.timestampMs; last = s; recent.addLast(s)
            record(s)
            _status.value = running(0)
            return
        }
        val rawDt = s.timestampMs - lastTs
        if (rawDt <= 0) return // duplicate or out-of-order
        val dt = rawDt.coerceAtMost(MAX_DT_MS)
        val dtSec = dt / 1000f
        lastTs = s.timestampMs

        distanceM += (last.speedKmh + s.speedKmh) / 2f / 3.6f * dtSec
        maxSpeed = maxOf(maxSpeed, s.speedKmh)
        val atM = distanceM

        if (s.gear != last.gear) {
            event(s, TraceEventType.GEAR_CHANGE)
            if (s.gear != Gear.PARK && last.gear != Gear.PARK) { gearShifts++; totalShifts++ }
        }
        // Speed and steering arrive as separate events ms apart, so rates use the newest sample >= RATE_WINDOW_MS old.
        recent.addLast(s)
        while (recent.size > 1 && s.timestampMs - recent[1].timestampMs >= RATE_WINDOW_MS) recent.removeFirst()
        val ref = recent.first()
        val win = s.timestampMs - ref.timestampMs
        val winSec = win / 1000f
        // Edge-triggered so one sustained maneuver counts once.
        val sharp = win in RATE_WINDOW_MS..MAX_DT_MS && abs(s.steeringDeg - ref.steeringDeg) / winSec > SHARP_DEG_PER_SEC
        if (sharp && !sharpActive) { sharps++; event(s, TraceEventType.SHARP_STEER) }
        sharpActive = sharp
        val hard = s.gear != Gear.PARK && win >= RATE_WINDOW_MS && (ref.speedKmh - s.speedKmh) / winSec > HARD_BRAKE_KMH_PER_SEC
        if (hard && !brakeActive) { hardBrakes++; event(s, TraceEventType.HARD_BRAKE) }
        brakeActive = hard

        // A stop only counts once the car has actually moved (leaving P at 0 km/h is not a stop).
        if (s.gear != Gear.PARK && s.speedKmh < STOP_KMH && atM > 0.5f) {
            stoppedMs += dt
            if (stoppedMs >= STOP_MS && !stopCounted) { stopCounted = true; stops++; event(s, TraceEventType.STOP) }
        } else { stoppedMs = 0; stopCounted = false }

        overMs = if (s.speedKmh > ABORT_KMH) overMs + dt else 0
        record(s)
        last = s

        val elapsed = s.timestampMs - t0
        val limitMs = d.timeLimitSec * 1000L
        when {
            overMs > ABORT_MS -> {
                done = true
                _status.value = RunStatus.Aborted("저속 상한 초과로 미션이 중단됐어요", buildRecord(d, elapsed, "중단"))
            }
            mode == RunMode.CHALLENGE && elapsed >= limitMs -> {
                done = true
                _status.value = RunStatus.Finished(buildRecord(d, limitMs, "시간 초과"))
            }
            stage == d.stages.lastIndex && s.gear == Gear.PARK && atM > 0.5f -> {
                done = true
                results += stageResult(d, stage)
                _status.value = RunStatus.Finished(buildRecord(d, elapsed, ""))
            }
            stage < d.stages.lastIndex && atM - stageStartM >= d.stages[stage].lengthM -> {
                results += stageResult(d, stage)
                stage++; stageStartM = atM; resetStageCounters()
                _status.value = running(elapsed)
            }
            else -> _status.value = running(elapsed)
        }
    }

    private fun running(elapsed: Long): RunStatus.Running {
        val d = dungeon!!
        val remaining = if (mode == RunMode.CHALLENGE) (d.timeLimitSec * 1000L - elapsed).coerceAtLeast(0) else 0L
        return RunStatus.Running(stage, elapsed, remaining, d.stages[stage].mission.title)
    }

    private fun resetStageCounters() {
        stops = 0; sharps = 0; hardBrakes = 0; gearShifts = 0; maxSpeed = 0f
        stoppedMs = 0; stopCounted = false
    }

    private fun starsFor(count: Int, ok3: Int) = when { count <= ok3 -> 3; count == ok3 + 1 -> 2; else -> 1 }

    private fun stageResult(d: Dungeon, i: Int): StageResult {
        val mission = d.stages[i].mission
        val supported = when (mission) {
            MissionType.SPIRAL_NO_STOP -> caps.speed
            MissionType.PILLAR_SMOOTH -> caps.speed && caps.steering
            MissionType.REVERSE_PARK_ONE_SHOT -> caps.gear
        }
        if (!supported) return StageResult(d.stages[i].index, mission, 0, "이 차량에서 지원하지 않는 미션", true)
        val (stars, summary) = when (mission) {
            MissionType.SPIRAL_NO_STOP -> starsFor(stops, 0) to "경사로 정지 ${stops}회 · 최고 속도 ${maxSpeed.toInt()}km/h"
            MissionType.PILLAR_SMOOTH ->
                starsFor(sharps + hardBrakes, 0) to "급조향 ${sharps}회 · 급제동 ${hardBrakes}회 · 최고 속도 ${maxSpeed.toInt()}km/h"
            MissionType.REVERSE_PARK_ONE_SHOT -> {
                val s = when { gearShifts <= 2 -> 3; gearShifts == 3 -> 2; else -> 1 }
                val note = if (mode == RunMode.CHALLENGE) " · 타임어택 ${(lastTs - t0) / 1000}초" else ""
                s to "기어 전환 ${gearShifts}회$note"
            }
        }
        return StageResult(d.stages[i].index, mission, stars, summary, stars >= 2)
    }

    /** Finished stages keep their result; every other stage gets 0 stars with [note] as summary. */
    private fun buildRecord(d: Dungeon, durationMs: Long, note: String): RunRecord {
        val all = results.toList() + d.stages.drop(results.size).map {
            StageResult(it.index, it.mission, 0, note, false)
        }
        return RunRecord(d.lotId, mode, startedAtMs, durationMs, totalShifts, all, trace.toList(), events.toList(), cleared = note.isEmpty())
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
        const val ABORT_MS = 2000L
    }
}
