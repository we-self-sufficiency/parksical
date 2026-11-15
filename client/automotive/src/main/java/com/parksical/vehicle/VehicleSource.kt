package com.parksical.vehicle

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Single source of vehicle data for the whole app.
 * Real implementation: [PleosVehicleSource] (AAOS CarPropertyManager + CarUxRestrictionsManager + Pleos Vehicle SDK).
 */
interface VehicleSource {
    val state: StateFlow<VehicleState>
    val capabilities: StateFlow<VehicleCapabilities>

    /** INFO_EXTERIOR_DIMENSIONS, or null when the car does not report it (then the user picks a size class). */
    suspend fun readDimensions(): VehicleDimensions?

    fun start()
    fun stop()
}

/**
 * Debug-build only: the Pleos emulator is a `user` build, so speed cannot be injected via adb and
 * Virtual Console has no speed card. When non-null this value replaces PERF_VEHICLE_SPEED.
 */
object DebugSpeedOverride {
    val kmh = MutableStateFlow<Float?>(null)
}
