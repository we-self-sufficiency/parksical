package com.parksical.domain.engine

import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.vehicle.VehicleState
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Distance = trapezoid integral of speed. Heading change (bicycle model, steering ratio 15, wheelbase 2.9 m)
 * is only accumulated while |steering| >= [RAMP_STEER_DEG], i.e. on the spiral ramp, and that same distance
 * is subtracted from the floor lane distance.
 */
class DefaultParkingSpotEstimator : ParkingSpotEstimator {
    private var lot: ParkingLot? = null
    private var last: VehicleState? = null
    private var distanceM = 0f
    private var rampM = 0f
    private var headingRad = 0f
    private var steeringSeen = false

    override fun start(lot: ParkingLot, nowMs: Long) {
        this.lot = lot; last = null; distanceM = 0f; rampM = 0f; headingRad = 0f; steeringSeen = false
    }

    override fun onSample(state: VehicleState) {
        val prev = last
        last = state
        if (lot == null || prev == null) return
        val dt = (state.timestampMs - prev.timestampMs).coerceAtMost(MAX_DT_MS)
        if (dt <= 0) return
        val ds = (prev.speedKmh + state.speedKmh) / 2f / 3.6f * dt / 1000f
        distanceM += ds
        if (abs(state.steeringDeg) > 0.5f) steeringSeen = true
        if (abs(state.steeringDeg) >= RAMP_STEER_DEG) {
            rampM += ds
            headingRad += Math.toRadians((abs(state.steeringDeg) / STEERING_RATIO).toDouble()).toFloat() * ds / WHEELBASE_M
        }
    }

    override fun estimate(nowMs: Long): ParkingSpotEstimate? {
        val lot = lot ?: return null
        val layout = lot.layout ?: return null
        val perFloor = lot.structure?.rampTurnsPerFloor
        val floorPos = if (perFloor != null && perFloor > 0f) headingRad / (2 * PI.toFloat()) / perFloor else 0f
        val floor = layout.floors[floorPos.roundToInt().coerceIn(0, layout.floors.lastIndex)]

        val onFloorM = (distanceM - layout.entranceToRampM - rampM).coerceAtLeast(0f)
        val zonePos = onFloorM / floor.laneLengthM * floor.zones.size
        val zone = floor.zones[zonePos.toInt().coerceIn(0, floor.zones.lastIndex)]

        // Ambiguous when between two floors, or close to a zone boundary.
        val floorAmb = 2 * abs(floorPos - floorPos.roundToInt())
        val zoneAmb = abs(2 * (zonePos - zonePos.toInt()) - 1)
        var confidence = 0.9f - 0.4f * floorAmb - 0.2f * zoneAmb
        if (!steeringSeen && layout.floors.size > 1) confidence = minOf(confidence, 0.3f)
        // Floor can not be derived without ramp geometry.
        if (perFloor == null && layout.floors.size > 1) confidence = minOf(confidence, 0.3f)
        return ParkingSpotEstimate(lot.id, floor.label, zone, confidence.coerceIn(0.1f, 0.9f), nowMs)
    }

    private companion object {
        const val MAX_DT_MS = 2000L
        const val RAMP_STEER_DEG = 90f
        const val STEERING_RATIO = 15f
        const val WHEELBASE_M = 2.9f
    }
}
