package com.parksical.navi

import android.content.Context
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/** Phase 0 stub. Owner: agent C (general mode + NaviHelper). */
class PleosNaviGateway(private val context: Context) : NaviGateway {
    private val _arrivals = MutableSharedFlow<NaviGateway.Arrival>(extraBufferCapacity = 4)
    override val arrivals: SharedFlow<NaviGateway.Arrival> = _arrivals
    override fun requestRoute(name: String, lat: Double, lng: Double) {}
    override fun start() {}
    override fun stop() {}
}
