package com.parksical.vehicle

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Phase 0 stub. Owner: agent A (vehicle layer). */
class PleosVehicleSource(private val context: Context) : VehicleSource {
    private val _state = MutableStateFlow(VehicleState())
    override val state: StateFlow<VehicleState> = _state
    private val _capabilities = MutableStateFlow(VehicleCapabilities())
    override val capabilities: StateFlow<VehicleCapabilities> = _capabilities

    override suspend fun readDimensions(): VehicleDimensions? = null
    override fun start() {}
    override fun stop() {}
}
