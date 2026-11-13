package com.parksical.vehicle

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.collectAsState
import com.parksical.ui.common.LocalVehicleState

/** Debug builds only. Call inside the parent fillMaxSize Box; it aligns itself bottom-left. */
@Composable
fun BoxScope.DebugSpeedPanel() {
    var open by remember { mutableStateOf(false) }
    val v = LocalVehicleState.current
    val override by DebugSpeedOverride.kmh.collectAsState()
    Column(
        Modifier
            .align(Alignment.BottomStart)
            .padding(8.dp)
            .width(if (open) 320.dp else 160.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xCC111111))
            .padding(8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.width(if (open) 304.dp else 144.dp)) {
            Text("DBG ${"%.1f".format(v.speedKmh)}km/h", color = Color.White, fontSize = 14.sp)
            OutlinedButton(onClick = { open = !open }) { Text(if (open) "접기" else "펼치기", fontSize = 12.sp) }
        }
        if (open) {
            Text(
                "기어 ${v.gear} · 조향 ${"%.0f".format(v.steeringDeg)}° · 브레이크 ${if (v.brakePressed) "ON" else "off"}",
                color = Color.White, fontSize = 13.sp,
            )
            Slider(
                value = override ?: v.speedKmh.coerceIn(0f, 20f),
                onValueChange = { DebugSpeedOverride.kmh.value = it },
                valueRange = 0f..20f,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                listOf(0f, 5f, 12f).forEach { p ->
                    Button(onClick = { DebugSpeedOverride.kmh.value = p }) { Text("${p.toInt()}", fontSize = 13.sp) }
                }
                OutlinedButton(onClick = { DebugSpeedOverride.kmh.value = null }) { Text("해제", fontSize = 13.sp) }
            }
        }
    }
}
