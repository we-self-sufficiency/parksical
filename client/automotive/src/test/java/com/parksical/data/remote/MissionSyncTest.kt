package com.parksical.data.remote

import com.parksical.domain.engine.DefaultMissionJudge
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.MissionType
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunOutcome
import com.parksical.domain.model.RunReason
import com.parksical.domain.model.RunStatus
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

private const val CATALOG = """
{"lotId":"b9239e04-5d3d-4551-bdb5-b650399b449e","structureVersion":1,"ruleVersion":"missions-v1",
 "rules":{"version":"missions-v1","maxSpeedKph":10,"maxElapsedMs":7200000,"maxGapMs":1000,"minContinuousSamples":2,"clockToleranceMs":5000,
  "scoring":{"noStopStars":3,"oneReverseStars":3,"smoothMaxStars":3}},
 "source":"SYNTHETIC","operationalAllowed":false,
 "items":[
  {"missionCode":"NO_STOP_RAMP","developmentStatus":"SYNTHETIC_ONLY","disabledReason":null,
   "stage":{"stageId":"NO_STOP_RAMP:ramp-b1","missionCode":"NO_STOP_RAMP","floorId":"ground","zoneId":"ground-a","rampId":"ramp-b1","parkingSpaceId":null,
    "requiredCapabilities":["speed","gear"],"requiredQuality":["speed","gear","segment","riskEvents"]},"physicalSupport":"UNCONFIRMED"},
  {"missionCode":"ONE_SHOT_REVERSE","developmentStatus":"SYNTHETIC_ONLY","disabledReason":null,
   "stage":{"stageId":"ONE_SHOT_REVERSE:basement1-s03","missionCode":"ONE_SHOT_REVERSE","floorId":"basement1","zoneId":"basement-a","rampId":null,"parkingSpaceId":"basement1-s03",
    "requiredCapabilities":["speed","gear"],"requiredQuality":["speed","gear","segment","riskEvents"]},"physicalSupport":"UNCONFIRMED"},
  {"missionCode":"PILLAR_FOREST","developmentStatus":"DISABLED","disabledReason":"OBSTACLE_EVIDENCE_UNCONFIRMED","stage":null,"physicalSupport":"UNCONFIRMED"},
  {"missionCode":"SMOOTH_STEERING","developmentStatus":"SYNTHETIC_ONLY","disabledReason":null,
   "stage":{"stageId":"SMOOTH_STEERING:basement-a","missionCode":"SMOOTH_STEERING","floorId":"basement1","zoneId":"basement-a","rampId":null,"parkingSpaceId":null,
    "requiredCapabilities":["speed","gear","steeringAngle"],"requiredQuality":["speed","gear","segment","riskEvents","steeringAngle"]},"physicalSupport":"UNCONFIRMED"},
  {"missionCode":"TIME_ATTACK","developmentStatus":"DISABLED","disabledReason":"SPEED_INCENTIVE_EXCLUDED","stage":null,"physicalSupport":"UNCONFIRMED"}
 ]}
"""

class MissionSyncTest {
    private val lot = ParkingLot(id = "b9239e04-5d3d-4551-bdb5-b650399b449e", name = "가상 주차장", lat = 0.0, lng = 0.0, isPartner = false)

    @Test fun catalogBecomesDungeonInPhysicalOrder() {
        val d = dungeonFromCatalog(lot, parseJson(CATALOG))!!
        assertEquals(listOf("NO_STOP_RAMP:ramp-b1", "SMOOTH_STEERING:basement-a", "ONE_SHOT_REVERSE:basement1-s03"), d.stages.map { it.stageId })
        assertEquals(listOf(MissionType.NO_STOP_RAMP, MissionType.SMOOTH_STEERING, MissionType.ONE_SHOT_REVERSE), d.stages.map { it.mission })
        assertEquals(listOf(60f, 50f, 0f), d.stages.map { it.lengthM })
        assertEquals(7200, d.timeLimitSec)
        assertEquals(1000L, d.maxGapMs)
        assertEquals("missions-v1", d.ruleVersion)
        assertEquals(1, d.structureVersion)
        assertEquals("가상 주차장 던전", d.name)
        assertEquals(3, d.stars) // no server difficulty -> 3
        assertTrue(d.openSlots.isEmpty())
        assertEquals(listOf("speed", "gear", "segment", "riskEvents", "steeringAngle"), d.stages[1].requiredQuality)
    }

    @Test fun catalogWithoutEnabledStagesIsNoDungeon() {
        val c = parseJson(CATALOG.replace("SYNTHETIC_ONLY", "DISABLED"))
        assertNull(dungeonFromCatalog(lot, c))
    }

    private fun completedRun(): Pair<Dungeon, com.parksical.domain.model.RunRecord> {
        val d = dungeonFromCatalog(lot, parseJson(CATALOG))!!
        val j = DefaultMissionJudge()
        j.start(d, RunMode.CHALLENGE, VehicleCapabilities(gear = true, speed = true, steering = true), 1_000)
        var t = 1_000L
        fun feed(g: Gear, kmh: Float) { t += 100; j.onSample(VehicleState(gear = g, speedKmh = kmh, timestampMs = t)) }
        feed(Gear.DRIVE, 7.2f)
        repeat(560) { feed(Gear.DRIVE, 7.2f) } // 112 m
        repeat(3) { feed(Gear.REVERSE, 1f) }
        feed(Gear.PARK, 0f)
        return d to (j.status.value as RunStatus.Finished).record.copy(clientRunId = "cabc123", startedAtEpochMs = 1_763_000_000_000)
    }

    @Suppress("UNCHECKED_CAST")
    @Test fun resultBodyMatchesTheServerContract() {
        val (d, rec) = completedRun()
        val b = buildResultBody(rec)!!
        assertEquals(setOf("expectedVersion", "clientResultId", "source", "outcome", "reason", "finishedAt", "elapsedMs", "stars", "stages"), b.keys)
        assertEquals(1, b["expectedVersion"]); assertEquals("SYNTHETIC", b["source"])
        assertEquals("COMPLETED", b["outcome"]); assertEquals("FINISHED", b["reason"])
        val stages = b["stages"] as List<Map<String, Any?>>
        assertEquals(d.stages.map { it.stageId }, stages.map { it["stageId"] })
        assertEquals(b["stars"], stages.sumOf { it["stars"] as Int })
        val elapsed = b["elapsedMs"] as Long
        assertEquals(stages.last()["endOffsetMs"], elapsed)
        assertEquals(rfc3339Utc(1_763_000_000_000 + elapsed), b["finishedAt"])
        var prevEnd = 0L
        stages.forEachIndexed { i, s ->
            assertEquals(
                setOf("stageId", "startOffsetMs", "endOffsetMs", "outcome", "reason", "stars", "uxState", "segmentEntered", "segmentExited", "parkingConfirmed", "metrics", "quality"),
                s.keys,
            )
            val start = s["startOffsetMs"] as Long; val end = s["endOffsetMs"] as Long
            assertTrue(start >= prevEnd && end > start && end <= elapsed); prevEnd = end
            assertEquals("ALLOWED", s["uxState"])
            assertTrue(s["outcome"] in listOf("SUCCESS", "FAILED"))
            val m = s["metrics"] as Map<String, Any?>
            // exactly one mission-specific count, the others null
            val own = listOf("stopCount", "abruptSteeringCount", "reverseSegmentCount")[i]
            listOf("stopCount", "abruptSteeringCount", "reverseSegmentCount").forEach { k -> assertEquals(k == own, m[k] != null) }
            assertTrue((m["movingDurationMs"] as Long) <= end - start)
            assertTrue((m["maxSpeedKph"] as Double) in 0.0..10.0)
            val q = s["quality"] as List<Map<String, Any?>>
            assertEquals(d.stages[i].requiredQuality, q.map { it["signal"] })
            q.forEach {
                assertEquals("AVAILABLE", it["status"]); assertEquals(end - start, it["coveredMs"])
                assertTrue((it["maxGapMs"] as Long) in 1..1000)
                if (it["signal"] == "speed") assertTrue((it["validSampleCount"] as Int) >= Math.ceil((end - start) / (it["maxGapMs"] as Long).toDouble()) + 1)
            }
            assertEquals(if (i == 2) true else null, s["parkingConfirmed"])
        }
        // ramp: moving the whole stage; reverse: strictly less than the stage
        val moving = stages.map { (it["metrics"] as Map<String, Any?>)["movingDurationMs"] as Long }
        assertEquals((stages[0]["endOffsetMs"] as Long) - (stages[0]["startOffsetMs"] as Long), moving[0])
        assertTrue(moving[2] < (stages[2]["endOffsetMs"] as Long) - (stages[2]["startOffsetMs"] as Long))
    }

    @Test fun abortedRunHasMatchingLastStageAndZeroStars() {
        val d = dungeonFromCatalog(lot, parseJson(CATALOG))!!
        val j = DefaultMissionJudge()
        j.start(d, RunMode.PRACTICE, VehicleCapabilities(gear = true, speed = true, steering = true), 0)
        var t = 0L
        repeat(60) { t += 100; j.onSample(VehicleState(gear = Gear.DRIVE, speedKmh = 7.2f, timestampMs = t)) }
        repeat(10) { t += 100; j.onSample(VehicleState(gear = Gear.PARK, speedKmh = 0f, timestampMs = t)) }
        val rec = (j.status.value as RunStatus.Aborted).partial.copy(clientRunId = "cx", startedAtEpochMs = 1_763_000_000_000)
        assertEquals(RunOutcome.ABORTED, rec.outcome); assertEquals(RunReason.STOPPED, rec.reason)
        val b = buildResultBody(rec)!!
        assertEquals("STOPPED", b["reason"]); assertEquals(0, b["stars"])
        @Suppress("UNCHECKED_CAST") val stages = b["stages"] as List<Map<String, Any?>>
        assertEquals(1, stages.size) // nothing after the aborted stage
        assertEquals("ABORTED", stages[0]["outcome"]); assertEquals("STOPPED", stages[0]["reason"])
        assertEquals(false, stages[0]["segmentExited"])
    }

    @Test fun runWithoutStageSpanIsNotSubmittedUnlessEarlyCancel() {
        val d = dungeonFromCatalog(lot, parseJson(CATALOG))!!
        val j = DefaultMissionJudge()
        j.start(d, RunMode.PRACTICE, VehicleCapabilities(gear = true, speed = true), 0)
        j.onSample(VehicleState(gear = Gear.PARK, timestampMs = 100, airbagDeployed = true))
        assertNull(buildResultBody((j.status.value as RunStatus.Aborted).partial.copy(clientRunId = "c")))
        j.start(d, RunMode.PRACTICE, VehicleCapabilities(gear = true, speed = true), 0)
        j.cancel()
        assertNotNull(buildResultBody((j.status.value as RunStatus.Aborted).partial.copy(clientRunId = "c")))
    }
}
