package com.parksical.domain.engine

import com.parksical.domain.model.DifficultyBreakdown
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunStatus
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleDimensions
import com.parksical.vehicle.VehicleState
import kotlinx.coroutines.flow.StateFlow

/** Pure Kotlin, no Android. Implementations live next to this file and have unit tests. */
interface DifficultyCalculator {
    /** 40% structure, 25% reviews, 20% driving data, 15% building age, then corrected for [size]. */
    fun calculate(lot: ParkingLot, size: VehicleSize): DifficultyBreakdown

    fun sizeOf(dimensions: VehicleDimensions): VehicleSize
}

/**
 * Judges one MAX run from the stream of [VehicleState] samples.
 * Feed every sample via [onSample]; it must keep working while the app is in the background.
 */
interface MissionJudge {
    val status: StateFlow<RunStatus>

    /** Missions whose inputs are not in [capabilities] are skipped (not failed). */
    fun start(dungeon: Dungeon, mode: RunMode, capabilities: VehicleCapabilities, nowMs: Long)

    fun onSample(state: VehicleState)

    fun reset()
}

/**
 * Estimates floor and zone from the drive since the lot entrance:
 * distance = integral of speed, floors = cumulative steering turns on the spiral ramp.
 */
interface ParkingSpotEstimator {
    fun start(lot: ParkingLot, nowMs: Long)

    fun onSample(state: VehicleState)

    /** Called when gear goes to P. Null when the lot has no layout. */
    fun estimate(nowMs: Long): ParkingSpotEstimate?
}
