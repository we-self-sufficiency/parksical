package com.parksical.navi

import ai.pleos.playground.navi.data.DestinationArrivedInfo
import ai.pleos.playground.navi.data.RouteInfo
import ai.pleos.playground.navi.helper.NaviHelper
import ai.pleos.playground.navi.helper.listener.NaviHelperEventListener
import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

private const val TAG = "PleosNaviGateway"

/** Wraps Pleos NaviHelper 3.0.5. Every call is guarded: a missing navi service must never crash the app. */
@SuppressLint("MissingPermission")
class PleosNaviGateway(private val context: Context) : NaviGateway {
    private val _arrivals = MutableSharedFlow<NaviGateway.Arrival>(extraBufferCapacity = 4)
    override val arrivals: SharedFlow<NaviGateway.Arrival> = _arrivals

    private var helper: NaviHelper? = null

    private val listener = object : NaviHelperEventListener {
        override fun onDestinationArrived(destinationArrivedInfo: DestinationArrivedInfo) {
            Log.i(TAG, "arrived: ${destinationArrivedInfo.name}")
            _arrivals.tryEmit(NaviGateway.Arrival(destinationArrivedInfo.name, SystemClock.elapsedRealtime()))
        }
    }

    override fun requestRoute(name: String, lat: Double, lng: Double) {
        try {
            helper?.requestRoute(RouteInfo(latitude = lat, longitude = lng, poiName = name, poiId = "", address = "", poiSubId = ""))
                ?: Log.w(TAG, "requestRoute ignored: not started")
        } catch (t: Throwable) {
            Log.w(TAG, "requestRoute failed", t)
        }
    }

    override fun start() {
        try {
            if (helper != null) return
            helper = NaviHelper(context).also {
                it.addListener(listener)
                it.initialize()
            }
        } catch (t: Throwable) {
            Log.w(TAG, "start failed", t)
        }
    }

    override fun stop() {
        try {
            helper?.let { it.removeListener(listener); it.release() }
        } catch (t: Throwable) {
            Log.w(TAG, "stop failed", t)
        }
        helper = null
    }
}
