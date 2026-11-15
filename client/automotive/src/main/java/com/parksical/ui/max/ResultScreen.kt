package com.parksical.ui.max

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.parksical.LocalAppContainer
import com.parksical.data.MockParkingRepository
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.Title
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.common.parkedOnly
import com.parksical.ui.theme.PixelColors

@Composable
fun ResultScreen(onBackToGeneral: () -> Unit) {
    val c = LocalAppContainer.current
    val parked = LocalVehicleState.current.isParked
    if (!parked) { NeedParkPanel(); return }
    val records by c.session.records.collectAsState()
    val record = records.lastOrNull { it.mode == RunMode.CHALLENGE }
    ResultContent(
        record = record,
        dungeon = record?.let { c.parking.dungeon(it.lotId) },
        stamps = stampsOf(c.session.baseStamps, records, c.parking::dungeon),
        onBack = parkedOnly(onBackToGeneral),
    )
}

/** Mockup 07. */
@Composable
internal fun ResultContent(
    record: RunRecord?,
    dungeon: Dungeon?,
    stamps: Int,
    onBack: () -> Unit,
) {
    if (record == null) {
        Box(Modifier.fillMaxSize().background(PixelColors.Bg), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
                Ko("아직 도전 기록이 없어요", 32, PixelColors.Gold)
                PixelButton("일반 모드로", onBack, Modifier.width(320.dp))
            }
        }
        return
    }
    val cleared = record.cleared(dungeon)
    val name = dungeon?.name ?: "던전"
    val maxStars = (dungeon?.stages?.size ?: record.stageResults.size).coerceAtLeast(1) * 3
    val next = Title.entries.firstOrNull { it.minStamps > stamps }
    Row(Modifier.fillMaxSize().background(PixelColors.Bg).padding(56.dp), horizontalArrangement = Arrangement.spacedBy(48.dp)) {
        Column(Modifier.width(560.dp).fillMaxHeight(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(24.dp)) {
            Mono(if (cleared) "DUNGEON\nCLEAR!" else "MISSION\nABORTED", 30, if (cleared) PixelColors.Gold else PixelColors.Orange, align = TextAlign.Center)
            PixelStamp(cleared, Modifier.size(360.dp))
            Ko(if (cleared) "$name 도장 획득" else "MISSION 중단", 34, align = TextAlign.Center)
            if (!cleared) Ko(record.reason.ko, 18, Px.Warm, false, align = TextAlign.Center)
            Ko(
                record.submit.ko + (record.receiptOutcome?.let { " · $it" } ?: ""),
                16, PixelColors.Lavender, false, align = TextAlign.Center,
            )
            Ko(
                "도장 ${stamps}개째 · " + (next?.let { "다음 칭호 '${it.label}'까지 ${it.minStamps - stamps}개" } ?: "최고 칭호 달성"),
                18, PixelColors.Lavender, false, align = TextAlign.Center,
            )
        }
        Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                StatCard("STARS", "${record.totalStars}/$maxStars", PixelColors.Gold, PixelColors.Gold, Modifier.weight(1f))
                StatCard("CLEAR TIME", mmss(record.durationMs), PixelColors.Paper, PixelColors.Paper, Modifier.weight(1f))
                StatCard("RANK", Title.of(stamps).label, PixelColors.Paper, PixelColors.Paper, Modifier.weight(1f))
            }
            record.stageResults.forEachIndexed { i, r ->
                PixelPanel(Modifier.fillMaxWidth(), padding = 18.dp) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        Mono("STAGE ${i + 1}", 13, PixelColors.Orange, Modifier.width(100.dp))
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Ko(r.mission.title, 24)
                            Ko(r.summary, 16, PixelColors.Lavender, false)
                        }
                        PixelStars(r.stars)
                    }
                }
            }
            Box(Modifier.weight(1f))
            Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                // no record-sharing API on the server yet (ranking S-15 is not built), so the button stays disabled
                PixelButton("기록 공유", {}, Modifier.weight(1f), filled = true, dim = true)
                PixelButton("일반 모드로", onBack, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, border: androidx.compose.ui.graphics.Color, valueColor: androidx.compose.ui.graphics.Color, modifier: Modifier) =
    PixelPanel(modifier, border = border, borderWidth = 4.dp) {
        Mono(label, 13, PixelColors.Lavender)
        Mono(value, 28, valueColor, Modifier.padding(top = 8.dp))
    }

private val PreviewDungeon = MockParkingRepository().dungeon("daon")!!

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewClear() = ResultContent(SampleData.record(RunMode.CHALLENGE, 3, 1), PreviewDungeon, 7, {})

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewAborted() =
    ResultContent(SampleData.record(RunMode.CHALLENGE, 0, 0, full = false), PreviewDungeon, 6, {})
