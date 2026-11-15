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
    /**
     * 40% structure, 25% reviews, 20% driving data, 15% building age, then corrected for [size].
     * Unknown (null) factors are skipped and listed in `missing`, weights renormalised over known ones.
     * If `lot.serverDifficulty` is present its score is used as-is (`fromServer = true`).
     */
    fun calculate(lot: ParkingLot, size: VehicleSize): DifficultyBreakdown

    fun sizeOf(dimensions: VehicleDimensions): VehicleSize
}

/**
 * Judges one MAX run from the stream of [VehicleState] samples.
 * Feed every sample via [onSample]; it must keep working while the app is in the background.
 */
interface MissionJudge {
    val status: StateFlow<RunStatus>

    /** A stage whose required signal is missing from [capabilities] ends the run UNVERIFIABLE (SIGNAL_QUALITY). */
    fun start(dungeon: Dungeon, mode: RunMode, capabilities: VehicleCapabilities, nowMs: Long)

    fun onSample(state: VehicleState)

    /** User gave up (only offered while parked): ends the run as ABORTED / USER_CANCELLED. No-op when not running. */
    fun cancel()

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
