package com.parksical.ui.general

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.kakao.vectormap.KakaoMap
import com.kakao.vectormap.KakaoMapReadyCallback
import com.kakao.vectormap.LatLng
import com.kakao.vectormap.MapLifeCycleCallback
import com.kakao.vectormap.MapView
import com.kakao.vectormap.label.LabelOptions
import com.kakao.vectormap.label.LabelStyle
import com.kakao.vectormap.label.LabelStyles
import com.kakao.vectormap.label.LabelTextBuilder
import com.parksical.BuildConfig
import com.parksical.ui.theme.GeneralColors

data class MapPin(val id: String, val lat: Double, val lng: Double, val caption: String, val tint: Int)

/**
 * Kakao map with one label per lot. Without KAKAO_NATIVE_APP_KEY the SDK is not initialised
 * (see ParksicalApp), so a placeholder is shown instead of creating a MapView.
 */
@Composable
fun KakaoMapPanel(centerLat: Double, centerLng: Double, pins: List<MapPin>, onPin: (String) -> Unit, modifier: Modifier = Modifier) {
    if (BuildConfig.KAKAO_NATIVE_APP_KEY.isEmpty()) {
        Box(modifier.background(GeneralColors.Map), contentAlignment = Alignment.Center) {
            Text("지도 키 미설정 (local.properties KAKAO_NATIVE_APP_KEY)", color = GeneralColors.TextSub)
        }
        return
    }
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    val currentOnPin by rememberUpdatedState(onPin)
    var map by remember { mutableStateOf<KakaoMap?>(null) }
    val mapView = remember {
        MapView(context).apply {
            start(object : MapLifeCycleCallback() {
                override fun onMapDestroy() { map = null }
                override fun onMapError(e: Exception) { Log.w("KakaoMapPanel", "map error", e) }
            }, object : KakaoMapReadyCallback() {
                override fun getPosition(): LatLng = LatLng.from(centerLat, centerLng)
                override fun getZoomLevel() = 16
                override fun onMapReady(m: KakaoMap) {
                    m.setOnLabelClickListener { _, _, label -> (label.tag as? String)?.let(currentOnPin); true }
                    map = m
                }
            })
        }
    }

    DisposableEffect(owner, mapView) {
        val obs = LifecycleEventObserver { _, e ->
            when (e) {
                Lifecycle.Event.ON_RESUME -> mapView.resume()
                Lifecycle.Event.ON_PAUSE -> mapView.pause()
                else -> {}
            }
        }
        owner.lifecycle.addObserver(obs)
        onDispose {
            owner.lifecycle.removeObserver(obs)
            mapView.finish()
        }
    }

    DisposableEffect(map, pins) {
        val layer = map?.labelManager?.layer
        pins.forEach { p ->
            layer?.addLabel(
                LabelOptions.from(LatLng.from(p.lat, p.lng))
                    .setStyles(LabelStyles.from(LabelStyle.from(pinBitmap(p.tint)).setTextStyles(28, android.graphics.Color.WHITE)))
                    .setTexts(LabelTextBuilder().setTexts(p.caption))
                    .setClickable(true)
                    .setTag(p.id)
            )
        }
        onDispose { layer?.removeAll() }
    }

    AndroidView({ mapView }, modifier)
}

/** Simple round pin so we don't ship image assets. */
private fun pinBitmap(tint: Int, size: Int = 44): Bitmap =
    Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { bmp ->
        val c = Canvas(bmp)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.color = android.graphics.Color.BLACK
        c.drawCircle(size / 2f, size / 2f, size / 2f, p)
        p.color = tint
        c.drawCircle(size / 2f, size / 2f, size / 2f - 4, p)
    }
