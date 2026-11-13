package com.parksical.ui.general

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.platform.LocalLifecycleOwner
import com.naver.maps.geometry.LatLng
import com.naver.maps.map.CameraUpdate
import com.naver.maps.map.MapView
import com.naver.maps.map.NaverMap
import com.naver.maps.map.overlay.Marker
import com.naver.maps.map.util.MarkerIcons

data class MapPin(val id: String, val lat: Double, val lng: Double, val caption: String, val tint: Int)

/** Naver map with one marker per lot. With an empty client id tiles stay blank but nothing crashes. */
@Composable
fun NaverMapPanel(centerLat: Double, centerLng: Double, pins: List<MapPin>, onPin: (String) -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val mapView = remember { MapView(context) }
    var map by remember { mutableStateOf<NaverMap?>(null) }

    DisposableEffect(owner, mapView) {
        val obs = LifecycleEventObserver { _, e ->
            runCatching {
                when (e) {
                    Lifecycle.Event.ON_CREATE -> {
                        mapView.onCreate(null)
                        mapView.getMapAsync { m ->
                            m.mapType = NaverMap.MapType.Navi
                            m.isNightModeEnabled = true
                            m.moveCamera(CameraUpdate.scrollAndZoomTo(LatLng(centerLat, centerLng), 15.0))
                            map = m
                        }
                    }
                    Lifecycle.Event.ON_START -> mapView.onStart()
                    Lifecycle.Event.ON_RESUME -> mapView.onResume()
                    Lifecycle.Event.ON_PAUSE -> mapView.onPause()
                    Lifecycle.Event.ON_STOP -> mapView.onStop()
                    Lifecycle.Event.ON_DESTROY -> mapView.onDestroy()
                    else -> {}
                }
            }
        }
        owner.lifecycle.addObserver(obs)
        onDispose { owner.lifecycle.removeObserver(obs) }
    }

    DisposableEffect(map, pins) {
        val markers = map?.let { m ->
            pins.map { p ->
                Marker().apply {
                    position = LatLng(p.lat, p.lng)
                    icon = MarkerIcons.BLACK
                    iconTintColor = p.tint
                    captionText = p.caption
                    captionTextSize = 16f
                    setOnClickListener { onPin(p.id); true }
                    this.map = m
                }
            }
        }.orEmpty()
        onDispose { markers.forEach { it.map = null } }
    }

    AndroidView({ mapView }, modifier)
}
