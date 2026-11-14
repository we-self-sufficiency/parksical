package com.parksical.ui.general

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.parksical.LocalAppContainer
import com.parksical.domain.model.SyncState
import com.parksical.ui.theme.GeneralColors
import java.util.Random

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ParkedScreen(onDone: () -> Unit) {
    val c = LocalAppContainer.current
    val spot by c.session.savedSpot.collectAsState()
    var review by remember { mutableStateOf<String?>(null) }

    Box(Modifier.fillMaxSize().background(GeneralColors.Bg).padding(40.dp)) {
        val s = spot
        if (s == null) {
            Column(Modifier.align(Alignment.Center), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Text("저장된 주차 위치가 없어요", color = GeneralColors.Text, fontSize = 24.sp)
                Button("홈으로", onDone)
            }
            return@Box
        }
        val lot = c.parking.lot(s.lotId)
        // (label, zones) per floor: server structure first, else the local layout.
        val floors = lot?.serverStructure?.floors?.map { f -> f.label to f.zones.map { it.label } }
            ?: lot?.layout?.floors?.map { it.label to it.zones }.orEmpty()
        val zones = floors.firstOrNull { it.first == s.floor }?.second.orEmpty()
        fun edit(floor: String, zone: String) = c.drive.correctSpot(s.copy(floor = floor, zone = zone, confidence = 1f, userEdited = true))

        Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(40.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Text("${s.floor} · ${s.zone}구역 부근에 주차했어요", color = GeneralColors.Text, fontSize = 36.sp, fontWeight = FontWeight.Bold)
                Text(
                    if (s.confidence >= 1f) "직접 확인한 위치" else "추정 위치 · 정확도 ${(s.confidence * 100).toInt()}%",
                    color = if (s.confidence >= 1f) GeneralColors.Link else GeneralColors.AccentSoft, fontSize = 20.sp,
                )
                Text(
                    when (s.sync) {
                        SyncState.SYNCED -> "서버에 저장됨"
                        SyncState.SYNCING -> "저장 중…"
                        SyncState.FAILED -> "서버 저장 실패 · 기기에 저장됨"
                        SyncState.LOCAL_ONLY -> "기기에 저장됨"
                    },
                    color = if (s.sync == SyncState.FAILED) GeneralColors.Accent else GeneralColors.TextSub, fontSize = 16.sp,
                )
                if (floors.isNotEmpty()) {
                    Text("층이 달라요?", color = GeneralColors.TextSub, fontSize = 16.sp)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        floors.forEach { (label, fz) ->
                            Pill(label, label == s.floor, {
                                edit(label, if (s.zone in fz) s.zone else fz.firstOrNull() ?: s.zone)
                            })
                        }
                    }
                    Text("구역이 달라요?", color = GeneralColors.TextSub, fontSize = 16.sp)
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        zones.forEach { z -> Pill("${z}구역", z == s.zone, { edit(s.floor, z) }) }
                    }
                }
                Text("오늘 주차 어땠나요?", color = GeneralColors.Text, fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    // local state only: no review backend yet
                    listOf("쉬움", "보통", "어려움").forEach { Pill(it, review == it, { review = it }) }
                }
                if (review != null) Text("소중한 의견 고마워요", color = GeneralColors.TextSub, fontSize = 16.sp)
                Box(Modifier.weight(1f))
                Button("완료", onDone)
            }
            Column(
                Modifier.clip(RoundedCornerShape(16.dp)).background(Color(0xFF1A1D22)).padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                PseudoQr(s.label, Modifier.size(280.dp))
                Text("내 휴대폰으로 위치 보내기", color = GeneralColors.Muted, fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun Button(text: String, onClick: () -> Unit) {
    Box(
        Modifier.fillMaxWidth().height(72.dp).clip(RoundedCornerShape(14.dp)).background(GeneralColors.Link).clickable(onClick = onClick),
        Alignment.Center,
    ) { Text(text, color = GeneralColors.Bg, fontSize = 22.sp, fontWeight = FontWeight.Bold) }
}

/** shortcut: visual placeholder, NOT a scannable QR; replace with a real encoder once the web page exists. */
@Composable
private fun PseudoQr(label: String, modifier: Modifier) {
    val n = 21
    val cells = remember(label) {
        val r = Random(label.hashCode().toLong())
        Array(n) { y -> BooleanArray(n) { x -> r.nextBoolean() } }.also { g ->
            for ((ox, oy) in listOf(0 to 0, n - 7 to 0, 0 to n - 7)) for (y in 0 until 7) for (x in 0 until 7) {
                g[oy + y][ox + x] = x == 0 || y == 0 || x == 6 || y == 6 || (x in 2..4 && y in 2..4)
            }
        }
    }
    Canvas(modifier.background(Color.White).padding(10.dp)) {
        val cell = size.width / n
        for (y in 0 until n) for (x in 0 until n) if (cells[y][x])
            drawRect(Color.Black, Offset(x * cell, y * cell), Size(cell, cell))
    }
}
