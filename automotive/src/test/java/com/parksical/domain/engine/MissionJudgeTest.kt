package com.parksical.domain.engine

import com.parksical.data.MockParkingRepository
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunStatus
import com.parksical.domain.model.TraceEventType
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MissionJudgeTest {
    private val dungeon = MockParkingRepository().dungeon("daon")!! // stages: 60 m, 50 m, last
    private val allCaps = VehicleCapabilities(gear = true, speed = true, steering = true, brake = true)
    private val judge = DefaultMissionJudge()
    private var t = 0L
    private var steer = 0f

    private fun begin(mode: RunMode = RunMode.CHALLENGE, caps: VehicleCapabilities = allCaps) =
        judge.start(dungeon, mode, caps, 0)

    private fun feed(gear: Gear, kmh: Float, dtMs: Long = 100, steering: Float = steer) {
        t += dtMs
        judge.onSample(VehicleState(gear = gear, speedKmh = kmh, steeringDeg = steering, timestampMs = t))
    }

    /** Drive [meters] at a constant 7.2 km/h (2 m/s). */
    private fun drive(meters: Float, gear: Gear = Gear.DRIVE) = repeat((meters / 0.2f).toInt()) { feed(gear, 7.2f) }

    private fun running() = judge.status.value as RunStatus.Running

    @Test fun waitsInParkThenAdvancesStagesByDistance() {
        begin()
        feed(Gear.PARK, 0f)
        assertEquals(0, running().stageIndex)
        assertEquals(0L, running().elapsedMs)
        feed(Gear.DRIVE, 7.2f)
        drive(61f)
        assertEquals(1, running().stageIndex)
        assertEquals(dungeon.stages[1].mission.title, running().hudText)
        drive(51f)
        assertEquals(2, running().stageIndex)
    }

    @Test fun fullCleanRunFinishesWithThreeStarsEach() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(112f)
        feed(Gear.PARK, 0f)
        val rec = (judge.status.value as RunStatus.Finished).record
        assertEquals(listOf(3, 3, 3), rec.stageResults.map { it.stars })
        assertTrue(rec.stageResults[2].summary.contains("타임어택"))
        assertTrue(rec.trace.isNotEmpty())
    }

    @Test fun spiralStopsAreCounted() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(20f)
        repeat(15) { feed(Gear.DRIVE, 0f) } // 1.5 s stopped
        drive(41f)
        drive(51f)
        feed(Gear.PARK, 0f)
        val rec = (judge.status.value as RunStatus.Finished).record
        assertEquals(2, rec.stageResults[0].stars)
        assertEquals(1, rec.events.count { it.type == TraceEventType.STOP })
    }

    @Test fun pillarSharpSteerAndHardBrake() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(61f)
        feed(Gear.DRIVE, 7.2f, steering = 0f)
        feed(Gear.DRIVE, 7.2f, steering = 50f) // 500 deg/s
        feed(Gear.DRIVE, 7.2f, steering = 50f) // steady in between
        feed(Gear.DRIVE, 7.2f, steering = 0f) // 500 deg/s back, second sharp event
        feed(Gear.DRIVE, 7.2f, steering = 0f)
        drive(51f)
        feed(Gear.PARK, 0f)
        val rec = (judge.status.value as RunStatus.Finished).record
        assertEquals(2, rec.events.count { it.type == TraceEventType.SHARP_STEER })
        assertEquals(1, rec.stageResults[1].stars)
    }

    @Test fun reverseGearShiftsRated() {
        begin(RunMode.PRACTICE)
        feed(Gear.DRIVE, 7.2f)
        drive(112f)
        feed(Gear.REVERSE, 1f); feed(Gear.DRIVE, 1f); feed(Gear.REVERSE, 1f) // 3 shifts
        feed(Gear.PARK, 0f)
        val rec = (judge.status.value as RunStatus.Finished).record
        assertEquals(2, rec.stageResults[2].stars)
        assertEquals(3, rec.gearShifts)
        assertTrue(!rec.stageResults[2].summary.contains("타임어택"))
    }

    @Test fun abortWhenOverTenKmhForMoreThanTwoSeconds() {
        begin()
        feed(Gear.DRIVE, 5f)
        repeat(20) { feed(Gear.DRIVE, 12f) } // 2.0 s, not yet more than 2 s
        assertTrue(judge.status.value is RunStatus.Running)
        feed(Gear.DRIVE, 12f)
        val st = judge.status.value as RunStatus.Aborted
        assertEquals("저속 상한 초과로 미션이 중단됐어요", st.reason)
    }

    @Test fun shortSpeedSpikeDoesNotAbort() {
        begin()
        feed(Gear.DRIVE, 5f)
        repeat(10) { feed(Gear.DRIVE, 12f) }
        feed(Gear.DRIVE, 5f)
        repeat(10) { feed(Gear.DRIVE, 12f) }
        assertTrue(judge.status.value is RunStatus.Running)
    }

    @Test fun challengeTimeoutFinishesWithZeroForUnfinishedStages() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(61f) // stage 1 done
        t += 60 * 60 * 1000L
        feed(Gear.DRIVE, 7.2f, dtMs = 1)
        val rec = (judge.status.value as RunStatus.Finished).record
        assertEquals(listOf(3, 0, 0), rec.stageResults.map { it.stars })
        assertEquals("시간 초과", rec.stageResults[1].summary)
    }

    @Test fun practiceHasNoTimeLimit() {
        begin(RunMode.PRACTICE)
        feed(Gear.DRIVE, 0f)
        t += 2 * 60 * 60 * 1000L
        feed(Gear.DRIVE, 0f, dtMs = 1)
        assertTrue(judge.status.value is RunStatus.Running)
    }

    @Test fun duplicateOutOfOrderAndGapSamples() {
        begin()
        feed(Gear.DRIVE, 36f.coerceAtMost(7.2f))
        val before = (judge.status.value as RunStatus.Running).elapsedMs
        judge.onSample(VehicleState(Gear.DRIVE, 7.2f, timestampMs = t)) // duplicate
        judge.onSample(VehicleState(Gear.DRIVE, 7.2f, timestampMs = t - 50)) // older
        assertEquals(before, running().elapsedMs)
        feed(Gear.DRIVE, 7.2f, dtMs = 60_000) // 60 s gap integrates only 2 s = 4 m
        feed(Gear.DRIVE, 7.2f)
        assertEquals(0, running().stageIndex) // 4.2 m, far from 60 m
    }

    @Test fun unsupportedMissionIsSkipped() {
        begin(caps = allCaps.copy(steering = false))
        feed(Gear.DRIVE, 7.2f)
        drive(112f)
        feed(Gear.PARK, 0f)
        val r = (judge.status.value as RunStatus.Finished).record.stageResults[1]
        assertEquals(0, r.stars)
        assertEquals("이 차량에서 지원하지 않는 미션", r.summary)
    }
}
