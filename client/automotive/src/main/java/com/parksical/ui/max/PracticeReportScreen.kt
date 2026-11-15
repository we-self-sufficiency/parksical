package com.parksical.ui.max

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.parksical.LocalAppContainer
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.TraceEventType
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.common.parkedOnly
import com.parksical.ui.theme.PixelColors
import kotlin.math.floor
import kotlin.math.min

@Composable
fun PracticeReportScreen(lotId: String, onPracticeAgain: () -> Unit, onBookChallenge: () -> Unit, onBackToGeneral: () -> Unit) {
    val c = LocalAppContainer.current
    if (!LocalVehicleState.current.isParked) { NeedParkPanel(); return }
    val records by c.session.records.collectAsState()
    ReportContent(
        attempts = records.filter { it.mode == RunMode.PRACTICE && it.lotId == lotId },
        onAgain = parkedOnly(onPracticeAgain), onBook = parkedOnly(onBookChallenge), onBack = parkedOnly(onBackToGeneral),
    )
}

private fun RunRecord.sharpCount() = events.count { it.type == TraceEventType.SHARP_STEER }

/** Target per attempt: gear shifts <= 2 and no sharp steering. */
internal fun RunRecord.hitTarget() = gearShifts <= 2 && sharpCount() == 0

/** Trailing run of attempts that hit the target. */
internal fun streakOf(attempts: List<RunRecord>) = attempts.takeLastWhile { it.hitTarget() }.size

@Composable
internal fun ReportContent(attempts: List<RunRecord>, onAgain: () -> Unit, onBook: () -> Unit, onBack: () -> Unit) {
    var picked by remember { mutableStateOf<Int?>(null) }
    val sel = (picked ?: (attempts.size - 1)).coerceIn(0, (attempts.size - 1).coerceAtLeast(0))
    val streak = streakOf(attempts)
    val ready = streak >= 3
    Row(Modifier.fillMaxSize().background(PixelColors.Bg).padding(40.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Ko("연습 리포트", 38)
                Mono("PRACTICE", 14, PixelColors.Orange)
                if (ready) Box(Modifier.background(PixelColors.Gold).padding(horizontal = 12.dp, vertical = 6.dp)) { Ko("도전 가능", 18, PixelColors.Bg) }
                Box(Modifier.weight(1f))
                PixelMockBadge()
            }
            if (attempts.isEmpty()) {
                PixelPanel(Modifier.weight(1f).fillMaxWidth(), border = PixelColors.Paper, borderWidth = 4.dp) { Ko("아직 연습 기록이 없어요. 한 번 달려볼까요?", 24, PixelColors.Gold) }
            } else {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    attempts.indices.forEach { i ->
                        Box(
                            Modifier.background(if (i == sel) PixelColors.Gold else PixelColors.Panel).tap { picked = i }.padding(horizontal = 16.dp, vertical = 10.dp),
                        ) { Mono("#${i + 1}", 14, if (i == sel) PixelColors.Bg else PixelColors.Paper) }
                    }
                }
                PixelPanel(Modifier.weight(1f).fillMaxWidth(), border = PixelColors.Paper, borderWidth = 4.dp, shadow = PixelColors.Purple, bg = PixelColors.BgDeep, padding = 0.dp) {
                    TraceMap(attempts[sel], attempts.getOrNull(sel - 1), Modifier.fillMaxSize())
                }
                Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
                    Legend(PixelColors.Gold, GEAR_ICON, "전후진 전환")
                    Legend(PixelColors.Orange, STEER_ICON, "급조향")
                    Mono("X 주행 거리 · Y 조향각", 12, Px.Dim)
                }
            }
        }
        Column(Modifier.width(560.dp).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            PixelPanel(Modifier.fillMaxWidth(), padding = 14.dp) {
                Row(Modifier.fillMaxWidth()) { listOf("회차", "기어 전환", "소요 시간", "급조향", "목표").forEachIndexed { i, h -> Ko(h, 15, PixelColors.Lavender, modifier = Modifier.weight(if (i == 0) .6f else 1f)) } }
                attempts.forEachIndexed { i, r ->
                    Row(Modifier.fillMaxWidth().padding(top = 10.dp).background(if (i == sel) Px.Slab else Color.Transparent).tap { picked = i }.padding(vertical = 6.dp)) {
                        Mono("#${i + 1}", 16, modifier = Modifier.weight(.6f))
                        Mono("${r.gearShifts}회", 16, modifier = Modifier.weight(1f))
                        Mono(mmss(r.durationMs), 16, modifier = Modifier.weight(1f))
                        Mono("${r.sharpCount()}회", 16, modifier = Modifier.weight(1f))
                        Mono(if (r.hitTarget()) "OK" else "-", 16, if (r.hitTarget()) Px.Green else Px.Muted, Modifier.weight(1f))
                    }
                }
                if (attempts.isEmpty()) Ko("-", 16)
            }
            PixelPanel(Modifier.fillMaxWidth(), border = if (ready) PixelColors.Gold else PixelColors.Orange, bg = Px.Ember) {
                Ko(
                    if (ready) "3회 연속 목표 달성! 다음 난이도 도전을 추천해요. 도전 예약으로 이어가 보세요."
                    else "목표: 기어 전환 2회 이내 · 급조향 없음. 3회 연속 달성하면 도전 가능 배지를 드려요 (현재 ${streak}회 연속).",
                    18, PixelColors.Paper, false,
                )
            }
            Box(Modifier.weight(1f))
            PixelButton("도전 예약", onBook, Modifier.fillMaxWidth(), filled = ready)
            PixelButton("다시 연습", onAgain, Modifier.fillMaxWidth(), filled = !ready)
            PixelButton("일반 모드로", onBack, Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun Legend(color: Color, icon: List<String>, text: String) = Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    Canvas(Modifier.size(20.dp)) { sprite(icon, mapOf('X' to color), size.width / 5f) }
    Ko(text, 16, PixelColors.Lavender, false)
}

private const val GW = 200
private const val GH = 80

/** Steering path on a GW x GH pixel grid; the previous attempt is drawn dim behind. Events are pixel icons on the path. */
@Composable
private fun TraceMap(rec: RunRecord, prev: RunRecord?, modifier: Modifier) {
    val maxD = maxOf(1f, rec.trace.maxOfOrNull { it.distanceM } ?: 0f, prev?.trace?.maxOfOrNull { it.distanceM } ?: 0f, rec.events.maxOfOrNull { it.distanceM } ?: 0f)
    Canvas(modifier) {
        val cell = floor(min(size.width / GW, size.height / GH)).coerceAtLeast(1f)
        val ox = (size.width - cell * GW) / 2; val oy = (size.height - cell * GH) / 2
        fun r(col: Color, x: Int, y: Int, w: Int = 1, h: Int = 1) = px(col, ox + x * cell, oy + y * cell, w * cell, h * cell)
        for (x in 0 until GW step 4) r(Px.Line, x, GH / 2, 2, 1)
        fun gx(d: Float) = ((d / maxD) * (GW - 12)).toInt() + 6
        fun gy(deg: Float) = (((-deg.coerceIn(-540f, 540f) + 540f) / 1080f) * (GH - 12)).toInt() + 6
        fun path(t: RunRecord, col: Color) {
            t.trace.zipWithNext().forEach { (a, b) ->
                val x0 = gx(a.distanceM); val x1 = gx(b.distanceM)
                for (x in x0..maxOf(x0, x1)) {
                    val f = if (x1 == x0) 0f else (x - x0).toFloat() / (x1 - x0)
                    r(col, x, gy(a.steeringDeg + (b.steeringDeg - a.steeringDeg) * f), 2, 2)
                }
            }
        }
        prev?.let { path(it, Px.Slab) }
        path(rec, PixelColors.Purple)
        rec.events.forEach { e ->
            val y = rec.trace.minByOrNull { kotlin.math.abs(it.distanceM - e.distanceM) }?.let { gy(it.steeringDeg) } ?: GH / 2
            val (icon, col) = when (e.type) {
                TraceEventType.GEAR_CHANGE -> GEAR_ICON to PixelColors.Gold
                TraceEventType.SHARP_STEER -> STEER_ICON to PixelColors.Orange
                else -> return@forEach
            }
            sprite(icon, mapOf('X' to col), cell, ox + (gx(e.distanceM) - 2) * cell, oy + (y - 2) * cell)
        }
    }
}

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewReportReady() = ReportContent(
    listOf(SampleData.record(RunMode.PRACTICE, 4, 2), SampleData.record(RunMode.PRACTICE, 2, 0), SampleData.record(RunMode.PRACTICE, 2, 0), SampleData.record(RunMode.PRACTICE, 1, 0)),
    {}, {}, {},
)

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewReportEarly() = ReportContent(listOf(SampleData.record(RunMode.PRACTICE, 4, 2), SampleData.record(RunMode.PRACTICE, 2, 0)), {}, {}, {})
