package com.parksical.ui.general

import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parksical.data.LotsStatus
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.parksical.LocalAppContainer
import com.parksical.domain.model.ParkingLot
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.common.parkedOnly
import com.parksical.ui.theme.GeneralColors
import kotlin.math.cos
import kotlin.math.hypot

private enum class Sort { EASY, NEAR }

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun HomeScreen(onOpenLot: (lotId: String) -> Unit, onOpenMaxEntry: (lotId: String?) -> Unit) {
    val c = LocalAppContainer.current
    val parked = LocalVehicleState.current.isParked
    val (size, picked) = mySize()
    var sort by remember { mutableStateOf(Sort.EASY) }
    var partnerOnly by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val lots by c.parking.lots.collectAsStateWithLifecycle()
    val status by c.parking.status.collectAsStateWithLifecycle()
    val dims by c.session.vehicleDimensions.collectAsStateWithLifecycle()
    // Re-query when the car changes (VEHICLE_ADJUSTED score); skipped for the initial value, the repo loads itself.
    var firstSize by remember { mutableStateOf(true) }
    LaunchedEffect(dims) {
        if (firstSize) firstSize = false else c.parking.refresh(dims)
    }

    val rows = remember(lots, size) { lots.map { it to c.difficulty.calculate(it, size) } }
    // shortcut: flat-earth distance (fine at city scale), swap for a real geo lib if lots span regions
    fun dist(l: ParkingLot) = l.distanceM?.toDouble() ?: hypot(
        (l.lat - c.parking.destinationLat) * 111_000.0,
        (l.lng - c.parking.destinationLng) * 111_000.0 * cos(Math.toRadians(l.lat)),
    )
    val shown = rows.filter { !partnerOnly || it.first.isPartner || it.first.prepayDiscountPercent > 0 }
        .sortedBy { if (sort != Sort.EASY) dist(it.first).toFloat() else if (it.second.insufficient) Float.MAX_VALUE else it.second.forMyCar }
    val pins = remember(rows) {
        rows.map { (l, b) ->
            val s = b.forMyCar
            MapPin(l.id, l.lat, l.lng, (if (b.insufficient) "정보 부족" else "★ ${fmt(s)}") + if (l.challengeOpen) " · 도전장" else "", (if (b.insufficient) GeneralColors.Muted else starColor(s)).toArgb())
        }
    }

    Column(Modifier.fillMaxSize().background(GeneralColors.Bg)) {
        // header
        Row(
            Modifier.fillMaxWidth().height(80.dp).background(GeneralColors.Header).padding(horizontal = 28.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Row(Modifier.width(200.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(32.dp).border(2.dp, GeneralColors.Text, RoundedCornerShape(8.dp)), Alignment.Center) {
                    Text("P", color = GeneralColors.Text, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                }
                Text("P지컬", color = GeneralColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            }
            Row(
                Modifier.weight(1f).height(52.dp).clip(RoundedCornerShape(12.dp)).background(GeneralColors.Surface).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("목적지  ", color = GeneralColors.TextSub, fontSize = 16.sp)
                Text(c.parking.destinationName, color = GeneralColors.Text, fontSize = 18.sp)
            }
            Row(
                Modifier.clip(RoundedCornerShape(12.dp)).background(GeneralColors.Surface).padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Box(
                    Modifier.height(48.dp).clip(RoundedCornerShape(9.dp)).background(GeneralColors.Text).padding(horizontal = 24.dp),
                    Alignment.Center,
                ) { Text("일반", color = GeneralColors.Bg, fontSize = 17.sp, fontWeight = FontWeight.Bold) }
                val toMax = parkedOnly { onOpenMaxEntry(null) }
                Row(
                    Modifier.height(48.dp).clip(RoundedCornerShape(9.dp)).dimUnless(parked).clickable(onClick = toMax).padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.size(14.dp).background(GeneralColors.Accent))
                    Text("P지컬 MAX", color = GeneralColors.Text, fontSize = 17.sp, fontWeight = FontWeight.Medium)
                }
            }
        }

        Row(Modifier.weight(1f)) {
            // map
            Box(Modifier.weight(1f).fillMaxHeight().background(GeneralColors.Map)) {
                KakaoMapPanel(c.parking.destinationLat, c.parking.destinationLng, pins, onOpenLot, Modifier.fillMaxSize())
                Row(
                    Modifier.align(Alignment.BottomStart).padding(24.dp).clip(RoundedCornerShape(12.dp))
                        .background(Color(0xEB121418)).border(1.dp, GeneralColors.Border, RoundedCornerShape(12.dp)).padding(16.dp, 12.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Text("주차 난이도", color = GeneralColors.Text, fontSize = 16.sp, fontWeight = FontWeight.Medium)
                    Legend(GeneralColors.Text, "쉬움 ★1–2"); Legend(GeneralColors.Muted, "보통 ★3"); Legend(GeneralColors.Accent, "어려움 ★4–5")
                }
            }
            // side panel
            Column(
                Modifier.width(520.dp).fillMaxHeight().background(GeneralColors.Header).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("목적지 주변 ${shown.size}곳", color = GeneralColors.Text, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                        val st = status
                        val (txt, col) = when (st) {
                            LotsStatus.Loading -> "불러오는 중…" to GeneralColors.Muted
                            LotsStatus.Server -> "서버 데이터" to GeneralColors.Link
                            is LotsStatus.Error -> st.reason to GeneralColors.Accent
                        }
                        Text(txt, color = col, fontSize = 13.sp, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(Color(0xFF22262D)).padding(10.dp, 3.dp))
                    }
                    Text(if (picked) "내 차(${size.label}) 기준" else "차급 선택 필요", color = if (picked) GeneralColors.TextSub else GeneralColors.Accent, fontSize = 16.sp)
                }
                if (!picked) SizePicker()
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("쉬운 순", sort == Sort.EASY, { sort = Sort.EASY })
                    Pill("가까운 순", sort == Sort.NEAR, { sort = Sort.NEAR })
                    Pill("제휴 할인", partnerOnly, { partnerOnly = !partnerOnly })
                }
                if (shown.isEmpty() && status != LotsStatus.Loading) Text(
                    when {
                        status is LotsStatus.Error -> "주차장 정보를 불러오지 못했어요 (${(status as LotsStatus.Error).reason})"
                        partnerOnly && lots.isNotEmpty() -> "제휴 할인 주차장이 없어요. 필터를 끄면 전체를 볼 수 있어요."
                        else -> "목적지 주변에 주차장이 없어요"
                    },
                    color = GeneralColors.TextSub, fontSize = 16.sp, modifier = Modifier.padding(top = 24.dp),
                )
                if (status is LotsStatus.Error) Pill("다시 시도", false, { scope.launch { c.parking.refresh(dims) } })
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(shown, key = { it.first.id }) { (lot, b) -> LotCard(lot, b, onOpenLot, onOpenMaxEntry, parked) }
                }
            }
        }
    }
}

@Composable
private fun Legend(color: Color, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(14.dp).clip(RoundedCornerShape(3.dp)).background(color))
        Text(text, color = GeneralColors.TextSub, fontSize = 16.sp)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LotCard(lot: ParkingLot, b: com.parksical.domain.model.DifficultyBreakdown, onOpen: (String) -> Unit, onChallenge: (String?) -> Unit, parked: Boolean) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier.fillMaxWidth().clip(shape).background(Color(0xFF1A1D22)).border(1.dp, GeneralColors.Border, shape)
            .clickable { onOpen(lot.id) }.padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(lot.name, color = GeneralColors.Text, fontSize = 18.sp, fontWeight = FontWeight.Bold)
            Text(
                if (b.insufficient) "정보 부족" else "★ ${fmt(b.forMyCar)}", color = GeneralColors.Bg, fontSize = 16.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(if (b.insufficient) GeneralColors.Muted else starColor(b.forMyCar)).padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
        val meta = listOfNotNull(
            lot.distanceM?.let { if (it >= 1000) "%.1fkm".format(it / 1000) else "${it.toInt()}m" },
            lot.walkMinutes?.let { if (it == 0) "건물 내" else "도보 ${it}분" },
            lot.fee30MinWon?.let { "30분 %,d원".format(it) },
            lot.hours,
            if (lot.prepayDiscountPercent > 0) "제휴 사전결제" else null,
        ).joinToString(" · ")
        if (meta.isNotEmpty()) Text(meta, color = GeneralColors.TextSub, fontSize = 16.sp)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            (if (lot.synthetic) lot.tags + "합성" else lot.tags).forEach {
                Text(it, color = GeneralColors.Muted, fontSize = 14.sp, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0xFF22262D)).padding(8.dp, 3.dp))
            }
            if (lot.challengeOpen) {
                val go = parkedOnly { onChallenge(lot.id) }
                ChallengeBadge(Modifier.dimUnless(parked).clickable(onClick = go))
            }
        }
    }
}
