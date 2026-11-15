package com.parksical.domain.engine

import com.parksical.data.MockParkingRepository
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunOutcome
import com.parksical.domain.model.RunReason
import com.parksical.domain.model.RunStatus
import com.parksical.domain.model.StageOutcome
import com.parksical.domain.model.TraceEventType
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MissionJudgeTest {
    private val dungeon = MockParkingRepository().dungeon("daon")!! // stages: ramp 60 m, smooth 50 m, reverse (ends on P)
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

    /** [n] sharp-steer events (500 deg/s each), leaving the wheel steady at the final angle. */
    private fun abrupt(n: Int) {
        repeat(n) { i ->
            steer = if (i % 2 == 0) 50f else 0f
            feed(Gear.DRIVE, 7.2f)
            repeat(5) { feed(Gear.DRIVE, 7.2f) }
        }
    }

    private fun reverseOnceAndPark() {
        repeat(3) { feed(Gear.REVERSE, 7.2f) }
        feed(Gear.PARK, 0f)
    }

    private fun running() = judge.status.value as RunStatus.Running
    private fun aborted() = judge.status.value as RunStatus.Aborted
    private fun finished() = (judge.status.value as RunStatus.Finished).record

    /** Runs stage 1 and 2 cleanly and puts the car at the start of the reverse stage. */
    private fun toStageThree() { feed(Gear.DRIVE, 7.2f); drive(61f); drive(51f); assertEquals(2, running().stageIndex) }

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

    @Test fun fullCleanRunCompletesWithNineStars() {
        begin()
        toStageThree()
        reverseOnceAndPark()
        val rec = finished()
        assertEquals(listOf(3, 3, 3), rec.stageResults.map { it.stars })
        assertEquals(RunOutcome.COMPLETED, rec.outcome)
        assertEquals(9, rec.totalStars)
        assertTrue(rec.trace.isNotEmpty())
        assertTrue(rec.cleared)
        // offsets are monotonic and never overlap; end > start
        val reps = rec.stageResults.map { it.report!! }
        reps.forEach { assertTrue(it.endOffsetMs > it.startOffsetMs) }
        reps.zipWithNext { a, b -> assertTrue(b.startOffsetMs >= a.endOffsetMs) }
        // reverse stage: parking confirmed, moving strictly shorter than the stage
        val last = reps[2]
        assertEquals(true, last.parkingConfirmed)
        assertTrue(last.metrics.movingDurationMs!! < last.endOffsetMs - last.startOffsetMs)
        assertEquals(1, last.metrics.reverseSegmentCount)
        // quality: exactly the required signals, covering the stage
        assertEquals(dungeon.stages[1].requiredQuality, reps[1].quality.map { it.signal })
        reps[1].quality.forEach {
            assertEquals("AVAILABLE", it.status)
            assertEquals(reps[1].endOffsetMs - reps[1].startOffsetMs, it.coveredMs)
            assertEquals(100L, it.maxGapMs)
        }
    }

    @Test fun rampStopAbortsEvenInParkGear() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(20f)
        repeat(10) { feed(Gear.PARK, 0f) } // shifting to P does not dodge the stop
        val st = aborted()
        assertEquals(RunReason.STOPPED, st.partial.reason)
        assertEquals(RunOutcome.ABORTED, st.partial.outcome)
        assertEquals(StageOutcome.ABORTED, st.partial.stageResults[0].outcome)
        assertEquals(1, st.partial.stageResults[0].report!!.metrics.stopCount)
        assertEquals(0, st.partial.totalStars)
        assertEquals(listOf(StageOutcome.NOT_RUN, StageOutcome.NOT_RUN), st.partial.stageResults.drop(1).map { it.outcome })
    }

    @Test fun rampStopInDriveAbortsAndShortStopDoesNot() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(20f)
        repeat(9) { feed(Gear.DRIVE, 0f) } // 0.9 s: not a stop
        assertTrue(judge.status.value is RunStatus.Running)
        feed(Gear.DRIVE, 7.2f)
        repeat(10) { feed(Gear.DRIVE, 0f) }
        assertEquals(RunReason.STOPPED, aborted().partial.reason)
        assertEquals(1, aborted().partial.events.count { it.type == TraceEventType.STOP })
    }

    @Test fun smoothStarsAreThreeMinusAbruptSteering() {
        listOf(0 to 3, 1 to 2, 2 to 1, 3 to 0, 4 to 0).forEach { (n, stars) ->
            t = 0; steer = 0f
            begin()
            feed(Gear.DRIVE, 7.2f)
            drive(61f)
            abrupt(n)
            drive(51f)
            reverseOnceAndPark()
            val rec = finished()
            assertEquals("abrupt=$n", stars, rec.stageResults[1].stars)
            assertEquals(n, rec.stageResults[1].report!!.metrics.abruptSteeringCount)
            assertEquals(if (stars == 0) StageOutcome.FAILED else StageOutcome.SUCCESS, rec.stageResults[1].outcome)
            assertEquals(RunOutcome.COMPLETED, rec.outcome) // FAILED stages still complete the run
            assertEquals(6 + stars, rec.totalStars)
        }
    }

    @Test fun splitSpeedAndSteeringEventsAreNotSharpSteer() {
        // Emulator: speed and steering arrive as separate events 1-6 ms apart (15 deg / 250 ms = 60 deg/s).
        begin()
        feed(Gear.DRIVE, 8f)
        drive(61f)
        var a = 0f
        repeat(40) { i ->
            feed(Gear.DRIVE, if (i % 2 == 0) 8f else 7.98f, dtMs = 248, steering = a)
            a += if (i < 20) 15f else -15f
            feed(Gear.DRIVE, 8f, dtMs = 2, steering = a)
        }
        steer = a
        drive(51f)
        reverseOnceAndPark()
        val rec = finished()
        assertEquals(0, rec.events.count { it.type == TraceEventType.SHARP_STEER || it.type == TraceEventType.HARD_BRAKE })
        assertEquals(3, rec.stageResults[1].stars)
    }

    @Test fun hardBrakingDoesNotAffectStars() {
        begin()
        feed(Gear.DRIVE, 8f)
        drive(61f)
        feed(Gear.DRIVE, 2f) // 6 km/h in 100 ms
        feed(Gear.DRIVE, 2f)
        drive(51f)
        reverseOnceAndPark()
        assertEquals(3, finished().stageResults[1].stars)
    }

    @Test fun reverseEntriesDecideTheStage() {
        // 0 entries (parked without reversing) -> FAILED; 1 -> 3 stars; 2 -> FAILED
        listOf(0 to 0, 1 to 3, 2 to 0).forEach { (entries, stars) ->
            t = 0; steer = 0f
            begin()
            toStageThree()
            drive(2f)
            repeat(entries) { i ->
                if (i > 0) feed(Gear.DRIVE, 1f)
                feed(Gear.REVERSE, 1f); feed(Gear.REVERSE, 1f)
            }
            feed(Gear.PARK, 0f)
            val r = finished().stageResults[2]
            assertEquals("entries=$entries", stars, r.stars)
            assertEquals(entries, r.report!!.metrics.reverseSegmentCount)
            assertEquals(if (stars == 0) StageOutcome.FAILED else StageOutcome.SUCCESS, r.outcome)
            assertEquals(true, r.report!!.parkingConfirmed)
        }
    }

    @Test fun speedOverTenAbortsImmediatelyButExactlyTenDoesNot() {
        begin()
        feed(Gear.DRIVE, 5f)
        feed(Gear.DRIVE, 10f)
        assertTrue(judge.status.value is RunStatus.Running)
        feed(Gear.DRIVE, 10.1f)
        val st = aborted()
        assertEquals("저속 상한 초과로 미션이 중단됐어요", st.reason)
        assertEquals(RunReason.SPEED_LIMIT, st.partial.reason)
        assertEquals(false, st.partial.cleared)
        assertEquals(0, st.partial.totalStars)
    }

    @Test fun airbagDuringStageTwoAbortsKeepingStageOne() {
        begin()
        drive(61f)
        assertEquals(1, running().stageIndex)
        t += 100
        judge.onSample(VehicleState(gear = Gear.DRIVE, speedKmh = 7.2f, timestampMs = t, airbagDeployed = true))
        val st = aborted()
        assertEquals("에어백이 전개되어 미션을 중단했어요", st.reason)
        assertEquals(RunReason.DANGER_EVENT, st.partial.reason)
        assertEquals(false, st.partial.cleared)
        assertTrue(st.partial.stageResults[0].stars > 0)
        assertEquals(1, st.partial.stageResults[1].report!!.metrics.dangerEventCount)
        assertEquals(StageOutcome.ABORTED, st.partial.stageResults[1].outcome)
        assertEquals(listOf(0), st.partial.stageResults.drop(2).map { it.stars })
    }

    @Test fun airbagWhileStillInParkAbortsImmediately() {
        begin()
        judge.onSample(VehicleState(gear = Gear.PARK, timestampMs = 100, airbagDeployed = true))
        val st = aborted()
        assertEquals(0L, st.partial.durationMs)
        assertEquals(false, st.partial.cleared)
    }

    @Test fun doorOpenWhileDrivingAborts() {
        begin()
        drive(61f)
        t += 100
        judge.onSample(VehicleState(gear = Gear.REVERSE, speedKmh = 3f, timestampMs = t, doorOpen = true))
        val st = aborted()
        assertEquals("문이 열려 미션을 중단했어요", st.reason)
        assertEquals(RunReason.DANGER_EVENT, st.partial.reason)
        assertTrue(st.partial.stageResults[0].stars > 0)
    }

    @Test fun doorOpenInParkIsIgnoredUntilLeavingPark() {
        begin()
        judge.onSample(VehicleState(gear = Gear.PARK, timestampMs = 100, doorOpen = true))
        assertTrue(judge.status.value is RunStatus.Running)
        judge.onSample(VehicleState(gear = Gear.DRIVE, timestampMs = 200, doorOpen = true))
        assertEquals(0L, aborted().partial.durationMs)
    }

    @Test fun cancelMidRunAbortsWithUserCancelled() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(20f)
        feed(Gear.PARK, 0f)
        judge.cancel()
        val rec = aborted().partial
        assertEquals(RunOutcome.ABORTED, rec.outcome)
        assertEquals(RunReason.USER_CANCELLED, rec.reason)
        assertEquals(StageOutcome.ABORTED, rec.stageResults[0].outcome)
        assertEquals(RunReason.USER_CANCELLED, rec.stageResults[0].reason)
        assertEquals(0, rec.totalStars)
    }

    @Test fun cancelBeforeLeavingParkHasNoStages() {
        begin()
        feed(Gear.PARK, 0f)
        judge.cancel()
        val rec = aborted().partial
        assertEquals(RunReason.USER_CANCELLED, rec.reason)
        assertTrue(rec.stageResults.all { it.outcome == StageOutcome.NOT_RUN })
    }

    @Test fun sampleGapOverOneSecondIsUnverifiable() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        drive(5f)
        feed(Gear.DRIVE, 7.2f, dtMs = 1500)
        val rec = aborted().partial
        assertEquals(RunOutcome.UNVERIFIABLE, rec.outcome)
        assertEquals(RunReason.SIGNAL_QUALITY, rec.reason)
        assertEquals(1500L, rec.stageResults[0].report!!.quality.first { it.signal == "speed" }.maxGapMs)
    }

    @Test fun missingSteeringCapabilityIsUnsupportedAndUnverifiable() {
        begin(caps = allCaps.copy(steering = false))
        feed(Gear.DRIVE, 7.2f)
        drive(112f)
        val rec = aborted().partial
        assertEquals(RunOutcome.UNVERIFIABLE, rec.outcome)
        assertEquals(RunReason.SIGNAL_QUALITY, rec.reason)
        val q = rec.stageResults[1].report!!.quality.first { it.signal == "steeringAngle" }
        assertEquals("UNSUPPORTED", q.status)
        assertEquals(0, q.validSampleCount); assertEquals(null, q.maxGapMs); assertEquals(0L, q.coveredMs)
        assertEquals(StageOutcome.SUCCESS, rec.stageResults[0].outcome)
    }

    @Test fun challengeTimeoutAbortsWithTimeLimit() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        repeat(36_001) { feed(Gear.DRIVE, 7.2f) } // 3600 s of continuous samples
        val rec = aborted().partial
        assertEquals(RunReason.TIME_LIMIT, rec.reason)
        assertEquals(RunOutcome.ABORTED, rec.outcome)
        assertEquals(StageOutcome.ABORTED, rec.stageResults[2].outcome)
        assertEquals(0, rec.totalStars)
    }

    @Test fun practiceHasNoTimeLimit() {
        begin(RunMode.PRACTICE)
        feed(Gear.DRIVE, 7.2f)
        repeat(72_100) { feed(Gear.DRIVE, 7.2f) } // 2 h
        assertTrue(judge.status.value is RunStatus.Running)
    }

    @Test fun duplicateAndOutOfOrderSamplesAreIgnored() {
        begin()
        feed(Gear.DRIVE, 7.2f)
        val before = running().elapsedMs
        judge.onSample(VehicleState(Gear.DRIVE, 7.2f, timestampMs = t)) // duplicate
        judge.onSample(VehicleState(Gear.DRIVE, 7.2f, timestampMs = t - 50)) // older
        assertEquals(before, running().elapsedMs)
        feed(Gear.DRIVE, 7.2f)
        assertNotNull(running())
    }

    @Test fun gearTransitionsAreCountedPerStage() {
        begin()
        toStageThree()
        feed(Gear.NEUTRAL, 1f); feed(Gear.REVERSE, 1f); feed(Gear.REVERSE, 1f); feed(Gear.PARK, 0f)
        val m = finished().stageResults[2].report!!.metrics
        assertEquals(3, m.gearTransitionCount)
    }
}
