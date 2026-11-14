package com.parksical.ui.general

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.draw.alpha
import com.parksical.domain.model.LotSource
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.VehicleSize
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.common.parkedOnly
import com.parksical.ui.theme.GeneralColors

private val Card = Color(0xFF1A1D22)
private val Chip = Color(0xFF22262D)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LotDetailScreen(lotId: String, onBack: () -> Unit, onOpenMaxEntry: (lotId: String) -> Unit) {
    val c = LocalAppContainer.current
    val parked = LocalVehicleState.current.isParked
    var loaded by remember(lotId) { mutableStateOf(c.parking.lot(lotId)) }
    LaunchedEffect(lotId) { loaded = c.parking.loadDetail(lotId, c.session.vehicleDimensions.value) ?: loaded }
    val lot = loaded
    val (size, picked) = mySize()

    Column(Modifier.fillMaxSize().background(GeneralColors.Bg)) {
        Row(
            Modifier.fillMaxWidth().height(80.dp).background(GeneralColors.Header).padding(horizontal = 28.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(52.dp).clip(RoundedCornerShape(12.dp)).background(GeneralColors.Surface).clickable(onClick = onBack), Alignment.Center) {
                Text("‹", color = GeneralColors.Text, fontSize = 30.sp)
            }
            Text(lot?.name ?: "주차장을 찾을 수 없어요", color = GeneralColors.Text, fontSize = 24.sp, fontWeight = FontWeight.Bold)
            lot?.subtitle?.let { Text(it, color = GeneralColors.TextSub, fontSize = 16.sp) }
        }
        if (lot == null) return@Column

        val mine = remember(lot, size) { c.difficulty.calculate(lot, size) }
        val compact = remember(lot) { c.difficulty.calculate(lot, VehicleSize.COMPACT) }
        val none = "정보 없음"

        Row(Modifier.fillMaxSize().padding(28.dp), horizontalArrangement = Arrangement.spacedBy(28.dp)) {
            // left: photo placeholder, info, actions
            Column(Modifier.weight(0.4f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                EntrancePlaceholder(Modifier.fillMaxWidth().height(300.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Info("요금", lot.fee30MinWon?.let { "30분 %,d원".format(it) } ?: none, Modifier.weight(1f))
                    Info("운영", lot.hours ?: none, Modifier.weight(1f))
                    Info("준공", lot.builtYear?.let { "${it}년" } ?: none, Modifier.weight(1f))
                }
                Column(Modifier.weight(1f)) {}
                // Server lots navigate only to a usable navigation coordinate (synthetic lots have none).
                val canNavigate = lot.source != LotSource.SERVER || lot.navigationLat != null
                if (!canNavigate) Text("합성 좌표라 길안내를 할 수 없어요", color = GeneralColors.Muted, fontSize = 16.sp)
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(
                        Modifier.weight(1f).height(72.dp).clip(RoundedCornerShape(14.dp)).background(GeneralColors.Link).alpha(if (canNavigate) 1f else 0.4f).clickable(enabled = canNavigate) {
                            c.session.navigatingLotId.value = lot.id
                            c.navi.requestRoute(lot.name, lot.navigationLat ?: lot.lat, lot.navigationLng ?: lot.lng)
                        },
                        Alignment.Center,
                    ) { Text("길안내 시작", color = GeneralColors.Bg, fontSize = 22.sp, fontWeight = FontWeight.Bold) }
                    Box(
                        Modifier.weight(1f).height(72.dp).clip(RoundedCornerShape(14.dp)).border(1.dp, Color(0xFF3A404A), RoundedCornerShape(14.dp)).clickable(onClick = onBack),
                        Alignment.Center,
                    ) { Text("더 쉬운 주차장 보기", color = GeneralColors.Text, fontSize = 22.sp) }
                }
            }
            // right: difficulty
            Column(Modifier.weight(0.6f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Column(Modifier.clip(RoundedCornerShape(16.dp)).background(Card).padding(28.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Column {
                            Text("내 차 기준 주차 난이도", color = GeneralColors.TextSub, fontSize = 16.sp)
                            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                if (mine.insufficient) {
                                    Text("정보 부족", color = GeneralColors.Muted, fontSize = 40.sp, fontWeight = FontWeight.Bold)
                                } else {
                                    Text("★ ${fmt(mine.forMyCar)}", color = starColor(mine.forMyCar), fontSize = 52.sp, fontWeight = FontWeight.Bold)
                                    Text("/ 5 · ${mine.level.label}", color = GeneralColors.Muted, fontSize = 18.sp, modifier = Modifier.padding(bottom = 8.dp))
                                }
                            }
                        }
                        Text(
                            if (mine.fromServer) {
                                (if (lot.serverDifficulty?.vehicleAdjusted == true) "내 차 기준" else "기준 차체(4,800×1,850mm) 기준") + "\n서버 산정"
                            } else "내 차(${size.label}${if (picked) "" else " · 차급 선택 필요"}) ★${fmt(mine.forMyCar)}\n소형차 기준 ★${fmt(compact.forMyCar)}",
                            color = GeneralColors.Muted, fontSize = 16.sp, lineHeight = 24.sp,
                            modifier = Modifier.clip(RoundedCornerShape(12.dp)).background(Chip).padding(16.dp, 12.dp),
                        )
                    }
                    if (!picked) SizePicker()
                    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                        if (mine.fromServer) {
                            if (mine.insufficient) Text("점수를 계산할 데이터가 부족해요", color = GeneralColors.TextSub, fontSize = 16.sp)
                            else {
                                Factor("주차장 구조", mine.structure)
                                Factor("이용자 리뷰", mine.review)
                                Factor("주행 데이터 집계", mine.driving)
                                Factor("건물 연식", mine.age)
                            }
                            if (mine.missing.isNotEmpty()) Text("부족한 정보: " + mine.missing.joinToString { it.label }, color = GeneralColors.Muted, fontSize = 15.sp)
                        } else {
                            Factor("주차장 구조 40%", mine.structure)
                            Factor("이용자 리뷰 25%", mine.review)
                            Factor("주행 데이터 집계 20%", mine.driving)
                            Factor("건물 연식 15%", mine.age)
                        }
                    }
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        (lot.tags + listOfNotNull(lot.avgGearShifts?.let { "평균 전후진 전환 ${fmt(it)}회" }, if (lot.reviewCount > 0) "리뷰 ${lot.reviewCount}건" else null)).forEach {
                            Text(it, color = GeneralColors.Muted, fontSize = 15.sp, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Chip).padding(10.dp, 6.dp))
                        }
                    }
                }
                if (lot.challengeOpen) ChallengeCard(lot, parked) { onOpenMaxEntry(lot.id) }
            }
        }
    }
}

@Composable
private fun Info(label: String, value: String, modifier: Modifier) {
    Column(modifier.clip(RoundedCornerShape(14.dp)).background(Card).padding(16.dp)) {
        Text(label, color = GeneralColors.TextSub, fontSize = 15.sp)
        Text(value, color = GeneralColors.Text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
private fun Factor(label: String, score: Float?) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(label, color = GeneralColors.Text, fontSize = 17.sp, modifier = Modifier.width(200.dp))
        Box(Modifier.weight(1f).height(10.dp).clip(RoundedCornerShape(5.dp)).background(Color(0xFF2C313A))) {
            if (score != null) Box(Modifier.fillMaxWidth((score / 5f).coerceIn(0f, 1f)).height(10.dp).clip(RoundedCornerShape(5.dp)).background(GeneralColors.Accent))
        }
        Text(score?.let(::fmt) ?: "정보 없음", color = if (score == null) GeneralColors.Muted else GeneralColors.Text, fontSize = if (score == null) 14.sp else 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.width(72.dp))
    }
}

@Composable
private fun ChallengeCard(lot: ParkingLot, parked: Boolean, onGo: () -> Unit) {
    val go = parkedOnly(onGo)
    Row(
        Modifier.fillMaxWidth().dimUnless(parked).background(Color(0xFF1B120C)).border(4.dp, GeneralColors.Accent).clickable(onClick = go).padding(24.dp, 20.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Box(Modifier.size(56.dp).background(Color(0xFFF2E3C6)), Alignment.BottomEnd) { Box(Modifier.size(20.dp).background(Color(0xFFD9412B))) }
        Column(Modifier.weight(1f)) {
            Text("도전장이 도착했습니다", color = GeneralColors.AccentSoft, fontSize = 28.sp, fontWeight = FontWeight.Bold)
            Text("P지컬 MAX 개방 · ${lot.challengeHours.orEmpty()} · 미션 3개", color = GeneralColors.Muted, fontSize = 16.sp, modifier = Modifier.padding(top = 4.dp))
        }
        Text("GO ▶", color = GeneralColors.Bg, fontSize = 18.sp, fontWeight = FontWeight.Bold, modifier = Modifier.background(GeneralColors.Accent).padding(16.dp, 14.dp))
    }
}

/** shortcut: drawn stand-in for the entrance photo; swap for a real image once assets exist. */
@Composable
private fun EntrancePlaceholder(modifier: Modifier) {
    Canvas(modifier.clip(RoundedCornerShape(16.dp)).background(Card)) {
        val w = size.width; val h = size.height
        drawRect(Color(0xFF23272E), Offset(0f, h * 0.62f), Size(w, h * 0.38f))
        drawRect(Color(0xFF0E1013), Offset(w * 0.28f, h * 0.22f), Size(w * 0.44f, h * 0.48f))
        drawRect(Color(0xFF2C313A), Offset(w * 0.24f, h * 0.18f), Size(w * 0.52f, h * 0.06f))
        for (i in 0..4) drawRect(Color(0xFF3A404A), Offset(w * (0.1f + i * 0.2f), h * 0.86f), Size(w * 0.1f, h * 0.02f))
    }
}
