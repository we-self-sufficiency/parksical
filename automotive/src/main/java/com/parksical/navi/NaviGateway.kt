package com.parksical.navi

import kotlinx.coroutines.flow.SharedFlow

/** Wraps Pleos NaviHelper: hands route guidance to the built-in navigation app. */
interface NaviGateway {
    /** Fires when navigation reports arrival (NaviHelper onDestinationArrived): start of spot estimation. */
    val arrivals: SharedFlow<Arrival>

    fun requestRoute(name: String, lat: Double, lng: Double)

    fun start()
    fun stop()

    data class Arrival(val name: String?, val atMs: Long)
}
