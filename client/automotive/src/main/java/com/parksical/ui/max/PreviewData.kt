package com.parksical.ui.max

import com.parksical.domain.model.MissionType
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunOutcome
import com.parksical.domain.model.RunReason
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.StageResult
import com.parksical.domain.model.TraceEvent
import com.parksical.domain.model.TraceEventType
import com.parksical.domain.model.TracePoint
import com.parksical.vehicle.Gear
import kotlin.math.sin

/** Fake records so the result / report screens can be checked without a real run. */
internal object SampleData {
    private fun results(stars: List<Int>) = listOf(
        StageResult(1, MissionType.NO_STOP_RAMP, stars[0], "경사로 정지 0회 · 최고 속도 8km/h", stars[0] > 0),
        StageResult(2, MissionType.SMOOTH_STEERING, stars[1], "급조향 1회 · 최고 속도 8km/h", stars[1] > 0),
        StageResult(3, MissionType.ONE_SHOT_REVERSE, stars[2], "후진 진입 1회 (목표 1회)", stars[2] > 0),
    )

    fun record(mode: RunMode, shifts: Int, sharp: Int, durMs: Long = 2_328_000, stars: List<Int> = listOf(3, 2, 2), full: Boolean = true): RunRecord {
        val trace = (0..60).map { i ->
            TracePoint(i * 1000L, i * 3f, 6f, (sin(i / 6.0) * 360).toFloat(), if (i > 50) Gear.REVERSE else Gear.DRIVE)
        }
        val events = List(shifts) { TraceEvent(40_000L + it * 3000L, 120f + it * 9f, TraceEventType.GEAR_CHANGE) } +
            List(sharp) { TraceEvent(15_000L + it * 8000L, 45f + it * 40f, TraceEventType.SHARP_STEER) }
        return RunRecord("daon", mode, 0L, durMs, shifts, if (full) results(stars) else results(stars).take(1), trace, events, cleared = full,
            outcome = if (full) RunOutcome.COMPLETED else RunOutcome.ABORTED, reason = if (full) RunReason.FINISHED else RunReason.SPEED_LIMIT)
    }
}
