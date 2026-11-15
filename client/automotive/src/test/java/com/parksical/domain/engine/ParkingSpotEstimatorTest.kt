package com.parksical.domain.engine

import com.parksical.data.MockParkingRepository
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI

class ParkingSpotEstimatorTest {
    private val repo = MockParkingRepository()
    private val est = DefaultParkingSpotEstimator()
    private var t = 0L

    private fun drive(meters: Float, steering: Float) {
        val steps = (meters / 0.5f).toInt() // 5 m/s (18 km/h), 100 ms steps
        repeat(steps) { t += 100; est.onSample(VehicleState(Gear.DRIVE, 18f, steering, timestampMs = t)) }
    }

    private fun spiralTurns(turns: Float, steering: Float = 270f): Float {
        val roadRad = Math.toRadians((steering / 15f).toDouble())
        return (turns * 2 * PI * 2.9 / roadRad).toFloat()
    }

    @Test fun twoTurnsOnFloorOfTwoTurnsIsB2AroundC() {
        est.start(repo.lot("daon")!!, 0)
        est.onSample(VehicleState(Gear.DRIVE, 18f, 0f, timestampMs = 0))
        drive(25f, 0f)
        drive(spiralTurns(2f), 270f)
        drive(50f, 0f)
        val e = est.estimate(1000)!!
        assertEquals("B2", e.floor)
        assertEquals("C", e.zone)
        assertTrue(e.confidence > 0.7f)
    }

    @Test fun straightDriveStaysOnB1() {
        est.start(repo.lot("daon")!!, 0)
        est.onSample(VehicleState(Gear.DRIVE, 18f, 0f, timestampMs = 0))
        drive(25f + 10f, 0f)
        val e = est.estimate(1000)!!
        assertEquals("B1", e.floor)
        assertEquals("A", e.zone)
    }

    @Test fun noSteeringOnMultiFloorLotLowersConfidence() {
        est.start(repo.lot("daon")!!, 0)
        est.onSample(VehicleState(Gear.DRIVE, 18f, 0f, timestampMs = 0))
        drive(100f, 0f)
        assertTrue(est.estimate(1000)!!.confidence <= 0.3f)
    }

    @Test fun lotWithoutLayoutGivesNull() {
        est.start(repo.lot("nuri")!!, 0)
        est.onSample(VehicleState(Gear.DRIVE, 18f, 0f, timestampMs = 0))
        drive(30f, 0f)
        assertNull(est.estimate(1000))
    }
}
