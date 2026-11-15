package com.parksical.ui.max

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.parksical.LocalAppContainer
import com.parksical.data.MockParkingRepository
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.Reservation
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunStatus
import com.parksical.domain.model.Title
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.common.parkedOnly
import com.parksical.ui.theme.PixelColors
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleState
import kotlin.math.min

@Composable
fun StageScreen(lotId: String, mode: RunMode, onExitToGeneral: () -> Unit) {
    val c = LocalAppContainer.current
    val status by c.judge.status.collectAsState()
    val reservation by c.session.reservation.collectAsState()
    val records by c.session.records.collectAsState()
    val caps by c.vehicle.capabilities.collectAsState()
    val v = LocalVehicleState.current
    StageContent(
        dungeon = c.parking.dungeon(lotId), mode = mode, status = status, vehicle = v, caps = caps,
        reservation = reservation?.takeIf { it.lotId == lotId },
        stamps = stampsOf(c.session.baseStamps, records, c.parking::dungeon),
        onStart = parkedOnly { c.drive.startRun(lotId, mode, SystemClock.elapsedRealtime()) },
        onExit = parkedOnly(onExitToGeneral),
        onCancelRun = parkedOnly { c.drive.cancelRun() },
    )
}

/** Stateless so it can be previewed. Not parked or uxRestricted -> minimal HUD only (no touch, no animation). */
@Composable
internal fun StageContent(
    dungeon: Dungeon?,
    mode: RunMode,
    status: RunStatus,
    vehicle: VehicleState,
    caps: VehicleCapabilities,
    reservation: Reservation?,
    stamps: Int,
    onStart: () -> Unit,
    onExit: () -> Unit,
    onCancelRun: () -> Unit,
) {
    var confirmGiveUp by remember { mutableStateOf(false) }
    val running = status is RunStatus.Running
    // While a run is live, leaving the screen means giving up; while driving back does nothing (HUD only).
    BackHandler(enabled = running) { if (vehicle.isParked && !vehicle.uxRestricted) confirmGiveUp = true }
    if (!vehicle.isParked || vehicle.uxRestricted) {
        MinimalHud(dungeon, mode, status)
        return
    }
    val exit = { if (running) confirmGiveUp = true else onExit() }
    val blocked = dungeon?.let { startBlockedReason(it, caps, vehicle) }
    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize().background(PixelColors.Bg)) {
        Row(
            Modifier.fillMaxWidth().background(PixelColors.Panel).padding(horizontal = 32.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            Ko("P지컬 MAX", 32, PixelColors.Gold)
            Box(Modifier.background(Color.Transparent).padding(2.dp)) { Mono("LV.${Title.of(stamps).ordinal + 1} ${Title.of(stamps).label}", 14, PixelColors.Lavender) }
            Mono("STAMP ×$stamps", 14, PixelColors.Lavender)
            Box(Modifier.weight(1f))
            PixelMockBadge()
            PixelButton("일반 모드로", exit, height = 52.dp, textSize = 20)
        }
        Box(Modifier.fillMaxWidth().height(4.dp).background(PixelColors.Paper))
        if (dungeon == null) {
            NeedParkPanelLike("도전 가능한 주차장이 없어요 · 이 주차장은 서버에 도전 미션이 없어요")
            return@Column
        }
        Row(Modifier.fillMaxSize().padding(32.dp), horizontalArrangement = Arrangement.spacedBy(32.dp)) {
            Column(Modifier.weight(1f).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                    Ko(dungeon.name, 38)
                    Mono("${"★".repeat(dungeon.stars)}${"☆".repeat((5 - dungeon.stars).coerceAtLeast(0))} ${if (dungeon.stars >= 4) "HARD" else "NORMAL"}", 14, PixelColors.Orange)
                }
                PixelPanel(Modifier.weight(1f).fillMaxWidth(), border = PixelColors.Paper, borderWidth = 4.dp, shadow = PixelColors.Purple, bg = PixelColors.BgDeep, padding = 0.dp) {
                    StageMap(dungeon, status)
                }
            }
            Column(Modifier.width(500.dp).fillMaxHeight(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                PixelPanel(Modifier.fillMaxWidth(), border = PixelColors.Gold, borderWidth = 4.dp) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                        Mono(if (mode == RunMode.CHALLENGE) "TIME" else "PRACTICE", 14, PixelColors.Lavender)
                        val ms = when (status) {
                            is RunStatus.Running -> if (mode == RunMode.CHALLENGE) status.remainingMs else status.elapsedMs
                            else -> if (mode == RunMode.CHALLENGE) dungeon.timeLimitSec * 1000L else 0L
                        }
                        Mono(mmss(ms), 34, PixelColors.Gold)
                    }
                }
                ReservationLine(reservation)
                val cur = (status as? RunStatus.Running)?.let(::currentStage)
                dungeon.stages.forEachIndexed { i, st ->
                    val ok = st.mission.supported(caps)
                    PixelPanel(
                        Modifier.fillMaxWidth().alpha(if (ok) 1f else 0.45f),
                        border = if (cur == i) PixelColors.Gold else PixelColors.PanelBorder, padding = 14.dp,
                    ) {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Mono(st.label, 13, if (cur == i) PixelColors.Gold else PixelColors.Orange)
                            if (ok) Mono(if (cur != null && i < cur) "CLEAR" else if (cur == i) "NOW" else "☆☆☆", 13, if (cur == i) PixelColors.Gold else Px.Muted)
                            else Ko("미지원 차량", 14, PixelColors.Lavender)
                        }
                        Ko(st.mission.title, 24)
                        Ko(st.mission.rule, 16, PixelColors.Lavender, false)
                    }
                }
                Box(Modifier.weight(1f))
                (status as? RunStatus.Aborted)?.let {
                    PixelPanel(Modifier.fillMaxWidth(), border = PixelColors.Orange, bg = Px.Ember) { Ko("MISSION 중단 · ${it.reason}", 17, Px.Warm) }
                }
                PixelPanel(Modifier.fillMaxWidth(), border = PixelColors.Orange, bg = Px.Ember) {
                    Ko(
                        if (status is RunStatus.Running) "판정 진행 중 · 정차 상태입니다. 다시 출발하면 최소 표시로 전환돼요."
                        else "P단 정차 중. 기어를 바꾸면 화면이 최소 표시로 전환되고 판정이 시작됩니다.", 17,
                        PixelColors.Paper, false,
                    )
                }
                if (status !is RunStatus.Running) {
                    blocked?.let { Ko(it, 17, PixelColors.Orange, false) }
                    PixelButton(
                        if (status is RunStatus.Aborted) "다시 시작" else if (mode == RunMode.CHALLENGE) "도전 시작" else "연습 시작",
                        if (blocked == null) onStart else ({}), Modifier.fillMaxWidth(), filled = true, dim = blocked != null, textSize = 26,
                    )
                }
            }
        }
    }
    if (confirmGiveUp) Box(Modifier.fillMaxSize().background(Color(0xB8050608)).tap {}, contentAlignment = Alignment.Center) {
        PixelPanel(Modifier.width(720.dp), border = PixelColors.Orange, borderWidth = 4.dp, shadow = PixelColors.Purple, padding = 32.dp) {
            Ko("도전을 포기할까요?", 34, PixelColors.Gold)
            Ko("지금까지의 진행은 기록되고 도전은 중단돼요.", 18, PixelColors.Lavender, false, Modifier.padding(vertical = 16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                PixelButton("포기", { confirmGiveUp = false; onCancelRun() }, Modifier.weight(1f))
                PixelButton("계속", { confirmGiveUp = false }, Modifier.weight(1f), filled = true)
            }
        }
    }
    }
}

/** Why the start button is off, or null. Doors open or a mission input the car lacks cannot produce a verifiable run. */
internal fun startBlockedReason(d: Dungeon, caps: VehicleCapabilities, v: VehicleState): String? = when {
    d.stages.any { !it.mission.supported(caps) } -> "이 차량에서 지원하지 않는 미션이 있어요"
    v.doorOpen -> "문을 닫아주세요"
    else -> null
}

/** RunStatus.stageIndex is treated as 0-based; see report. */
private fun currentStage(r: RunStatus.Running) = r.stageIndex

@Composable
private fun NeedParkPanelLike(text: String) = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Ko(text, 28, PixelColors.Gold) }

@Composable
private fun ReservationLine(r: Reservation?) {
    Ko(
        if (r != null && r.minutes == 0) "예약 기능 준비 중 · 바로 시작"
        else if (r != null) "예약 ${r.slot} · ${r.minutes}분 · ${won(r.paidWon)} 결제됨" else "예약 없음 · 데모 진행",
        16, if (r != null) PixelColors.Lavender else Px.Dim, false,
    )
}

@Composable
private fun MinimalHud(dungeon: Dungeon?, mode: RunMode, status: RunStatus) {
    val total = dungeon?.stages?.size ?: 3
    val (stage, ms, text) = when (status) {
        is RunStatus.Running -> Triple(min(currentStage(status) + 1, total), if (mode == RunMode.CHALLENGE) status.remainingMs else status.elapsedMs, status.hudText)
        is RunStatus.Idle -> Triple(1, if (mode == RunMode.CHALLENGE) (dungeon?.timeLimitSec ?: 0) * 1000L else 0L, "미션 대기 중")
        else -> Triple(total, 0L, "미션 종료")
    }
    Box(Modifier.fillMaxSize().background(Px.Hud)) {
        Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(48.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(80.dp)) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Mono("STAGE", 20, PixelColors.Lavender)
                    Row(verticalAlignment = Alignment.Bottom) { Mono("$stage", 96); Mono("/$total", 40, Px.Muted) }
                }
                Box(Modifier.size(4.dp, 200.dp).background(Px.Slab))
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Mono(if (mode == RunMode.CHALLENGE) "TIME" else "ELAPSED", 20, PixelColors.Lavender)
                    Mono(mmss(ms), 96, PixelColors.Gold)
                }
            }
            Ko(text, 44)
            Row(
                Modifier.background(Color.Transparent).padding(4.dp),
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Box(Modifier.size(18.dp).background(Px.Green))
                Ko("판정 중 · 정차하면 결과를 보여드려요", 24, PixelColors.Lavender, false)
            }
        }
        Row(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(32.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Ko("주행 중 화면 조작 잠김 · 애니메이션 정지", 18, Px.Dim, false)
            Mono("LIMIT 10km/h", 14, Px.Dim)
        }
    }
}

private val ROUTE = listOf(12 to 22, 50 to 22, 52 to 50, 148 to 50, 148 to 64, 127 to 64, 127 to 76)

/** 160x106 pixel grid like mockup 05: three floor slabs, dotted route (done=orange, current=gold), car at the current stage start. */
@Composable
private fun StageMap(dungeon: Dungeon, status: RunStatus) {
    val n = dungeon.stages.size
    val cur = (status as? RunStatus.Running)?.let(::currentStage) ?: -1
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Canvas(Modifier.fillMaxSize()) {
            val cell = kotlin.math.floor(min(size.width / 160f, size.height / 106f)).coerceAtLeast(1f)
            val ox = (size.width - cell * 160) / 2; val oy = (size.height - cell * 106) / 2
            fun r(col: Color, x: Int, y: Int, w: Int, h: Int) = px(col, ox + x * cell, oy + y * cell, w * cell, h * cell)
            listOf(8, 36, 64, 92).forEach { r(Px.Line, 4, it, 152, 2) }
            r(Px.Slab, 8, 12, 40, 20); r(Px.Slab, 56, 40, 96, 20); r(Px.Slab, 8, 68, 144, 20)
            listOf(70, 86, 102, 118, 134).forEachIndexed { i, x -> r(PixelColors.Paper, x, 42 + (i % 2) * 12, 4, 4) }
            for (x in listOf(96, 108, 120, 132, 144)) r(PixelColors.PanelBorder, x, 70, 2, 16)
            r(PixelColors.Gold, 122, 72, 10, 1); r(PixelColors.Gold, 122, 85, 10, 1); r(PixelColors.Gold, 122, 72, 1, 14); r(PixelColors.Gold, 131, 72, 1, 14)
            r(PixelColors.Gold, 125, 77, 4, 4)
            // route cells
            val pts = ArrayList<Pair<Int, Int>>()
            for (i in 0 until ROUTE.size - 1) {
                val (x0, y0) = ROUTE[i]; val (x1, y1) = ROUTE[i + 1]
                val steps = maxOf(kotlin.math.abs(x1 - x0), kotlin.math.abs(y1 - y0)) / 4
                for (k in 0 until steps) pts += (x0 + (x1 - x0) * k / steps) to (y0 + (y1 - y0) * k / steps)
            }
            pts.forEachIndexed { i, (x, y) ->
                val stage = i * n / pts.size
                val col = when { cur < 0 -> Px.Muted; stage < cur -> PixelColors.Orange; stage == cur -> PixelColors.Gold; else -> Px.Muted }
                r(col, x, y, 2, 2)
            }
            val carAt = pts[(maxOf(cur, 0) * pts.size / n).coerceAtMost(pts.size - 1)]
            sprite(listOf("..llll..", "..llll..", "bbbbbbbb", "bbbbbbbb", "bbbbbbbb", ".ww..ww."), mapOf('b' to PixelColors.Orange, 'l' to Px.Warm, 'w' to PixelColors.Paper), cell, ox + (carAt.first - 4) * cell, oy + (carAt.second - 8) * cell)
        }
        val h = maxHeight
        Mono("B1 입구", 14, PixelColors.Lavender, Modifier.offset(12.dp, 10.dp))
        Mono("B2", 14, PixelColors.Lavender, Modifier.offset(12.dp, h * 0.37f))
        Mono("B3", 14, PixelColors.Lavender, Modifier.offset(12.dp, h * 0.63f))
    }
}

private val PreviewCaps = VehicleCapabilities(gear = true, speed = true, steering = true, brake = false)
private val PreviewDungeon = MockParkingRepository().dungeon("daon")!!

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewStageIdle() = StageContent(PreviewDungeon, RunMode.CHALLENGE, RunStatus.Idle, VehicleState(), PreviewCaps.copy(steering = false), null, 7, {}, {}, {})

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewStageRunningParked() =
    StageContent(PreviewDungeon, RunMode.CHALLENGE, RunStatus.Running(1, 900_000, 2_700_000, "부드러운 조향"), VehicleState(), PreviewCaps, null, 7, {}, {}, {})

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewHud() =
    StageContent(PreviewDungeon, RunMode.CHALLENGE, RunStatus.Running(1, 900_000, 2_472_000, "부드러운 조향"), VehicleState(gear = Gear.DRIVE, speedKmh = 6f), PreviewCaps, null, 7, {}, {}, {})
