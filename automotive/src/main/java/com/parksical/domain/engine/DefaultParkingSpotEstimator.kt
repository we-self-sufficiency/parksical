package com.parksical.domain.engine

import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.vehicle.VehicleState

/** Phase 0 stub. Owner: agent B (domain engines). */
class DefaultParkingSpotEstimator : ParkingSpotEstimator {
    override fun start(lot: ParkingLot, nowMs: Long) {}
    override fun onSample(state: VehicleState) {}
    override fun estimate(nowMs: Long): ParkingSpotEstimate? = null
}
