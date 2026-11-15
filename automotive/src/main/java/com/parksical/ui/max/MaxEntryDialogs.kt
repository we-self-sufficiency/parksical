package com.parksical.ui.max

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.parksical.LocalAppContainer
import com.parksical.data.MockParkingRepository
import com.parksical.data.remote.ApiException
import com.parksical.data.remote.ReservationPolicy
import com.parksical.data.remote.ReservationQuote
import com.parksical.data.remote.ReservationSlot
import com.parksical.data.remote.reservationReason
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.Reservation
import com.parksical.domain.model.RunMode
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.common.parkedOnly
import com.parksical.ui.theme.GeneralColors
import com.parksical.ui.theme.PixelColors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/** Double confirm: step 1 mode switch (general tone), step 2 reservation + mock payment (pixel tone). */
@Composable
fun MaxEntryDialogs(lotId: String?, onDismiss: () -> Unit, onConfirmed: (Reservation) -> Unit) {
    val c = LocalAppContainer.current
    val lots = remember { c.parking.lots.value.mapNotNull { l -> c.parking.dungeon(l.id)?.let { l to it } } }
    MaxEntryContent(lots, lotId, onDismiss, onConfirmed)
}

/** Slots stay contiguous: tapping a neighbour extends, tapping an end shrinks, anything else restarts. */
internal fun toggleSlot(sel: Set<Int>, i: Int): Set<Int> = when {
    i in sel -> if (i == sel.min() || i == sel.max()) sel - i else sel
    sel.isEmpty() || i == sel.min() - 1 || i == sel.max() + 1 -> sel + i
    else -> setOf(i)
}

@Composable
internal fun MaxEntryContent(
    lots: List<Pair<ParkingLot, Dungeon>>,
    initialLotId: String?,
    onDismiss: () -> Unit,
    onConfirmed: (Reservation) -> Unit,
) {
    val parked = LocalVehicleState.current.isParked
    var step by remember { mutableStateOf(1) }
    val lotSel by remember { mutableStateOf(lots.firstOrNull { it.first.id == initialLotId }?.first?.id ?: lots.firstOrNull()?.first?.id) }
    val pair = lots.firstOrNull { it.first.id == lotSel }
    // Scrim swallows touches so nothing behind the dialog can be hit.
    Box(Modifier.fillMaxSize().background(Color(0xB8050608)).tap {}, contentAlignment = Alignment.Center) {
        when {
            pair == null -> GeneralPanel {
                Text26("도전 가능한 주차장이 없어요")
                Text("이 주변 주차장에는 서버 도전 미션이 없어요", color = GeneralColors.TextSub, fontSize = 20.sp)
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) { GButton("일반 모드로", onDismiss, primary = false, dim = false) }
            }
            step == 1 -> ModeSwitchPanel(pair.second, parked, onDismiss) { step = 2 }
            else -> ReservationPanel(pair, parked, { step = 1 }, onConfirmed)
        }
    }
}

@Composable
private fun GeneralPanel(content: @Composable () -> Unit) {
    Column(
        Modifier.widthIn(max = 760.dp).fillMaxWidth(0.6f)
            .background(GeneralColors.Surface, RoundedCornerShape(20.dp))
            .border(1.dp, GeneralColors.Border, RoundedCornerShape(20.dp)).padding(40.dp),
        verticalArrangement = Arrangement.spacedBy(28.dp),
    ) { content() }
}

@Composable
private fun Text26(t: String) = Text(t, color = GeneralColors.Text, fontSize = 30.sp, fontWeight = FontWeight.Bold)

@Composable
private fun GButton(text: String, onClick: () -> Unit, primary: Boolean, dim: Boolean, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(14.dp)
    Box(
        modifier.alpha(if (dim) 0.4f else 1f).height(68.dp)
            .background(if (primary) GeneralColors.Text else Color.Transparent, shape)
            .border(1.dp, if (primary) GeneralColors.Text else Color(0xFF3A404A), shape).tap(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text, color = if (primary) GeneralColors.Bg else GeneralColors.Text, fontSize = 20.sp,
            fontWeight = if (primary) FontWeight.Bold else FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 40.dp),
        )
    }
}

@Composable
private fun ModeSwitchPanel(d: Dungeon, parked: Boolean, onDismiss: () -> Unit, onNext: () -> Unit) {
    GeneralPanel {
        Row(horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text("확인 1 / 2", color = GeneralColors.TextSub, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Box(Modifier.size(32.dp, 6.dp).background(GeneralColors.Text, RoundedCornerShape(3.dp)))
                Box(Modifier.size(32.dp, 6.dp).background(Color(0xFF3A404A), RoundedCornerShape(3.dp)))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text26("P지컬 MAX로 전환할까요?")
            Text(
                "화면이 픽셀 게임 스타일로 바뀌고, 도전장이 있는 주차장만 지도에 남습니다. 언제든 상단 버튼으로 일반 모드로 돌아올 수 있어요.",
                color = GeneralColors.Muted, fontSize = 18.sp, lineHeight = 28.sp,
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column(
                Modifier.weight(1f).height(140.dp).background(Color(0xFF14171B), RoundedCornerShape(12.dp))
                    .border(1.dp, Color(0xFF2C313A), RoundedCornerShape(12.dp)),
                verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(Modifier.background(GeneralColors.Accent, RoundedCornerShape(8.dp)).padding(horizontal = 12.dp, vertical = 6.dp)) {
                    Text("★ ${d.stars}", color = GeneralColors.Bg, fontSize = 16.sp, fontWeight = FontWeight.Bold)
                }
                Text("일반 모드", color = GeneralColors.TextSub, fontSize = 16.sp)
            }
            Text("→", color = GeneralColors.TextSub, fontSize = 28.sp)
            PixelPanel(Modifier.weight(1f).height(140.dp), border = PixelColors.Paper, borderWidth = 4.dp, shadow = PixelColors.Purple, padding = 8.dp) {
                Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(10.dp, Alignment.CenterVertically), horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(Modifier.background(Color(0xFF2A1F4A)).border(2.dp, PixelColors.Gold).padding(horizontal = 10.dp, vertical = 6.dp)) {
                        Mono("★${d.stars}", 16, PixelColors.Gold)
                    }
                    Ko("P지컬 MAX", 22)
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            GButton("취소", parkedOnly(onDismiss), primary = false, dim = !parked, modifier = Modifier.weight(1f))
            GButton("전환하기", parkedOnly(onNext), primary = true, dim = !parked, modifier = Modifier.weight(1f))
        }
    }
}

private sealed interface Load {
    object Loading : Load
    class Failed(val reason: String) : Load
    class Ready(val policy: ReservationPolicy, val slots: List<ReservationSlot>) : Load
}

private val KST = ZoneId.of("Asia/Seoul")
private val HM = DateTimeFormatter.ofPattern("HH:mm").withZone(KST)
private const val MAX_SLOTS = 8 // 240 min

@Composable
private fun ReservationPanel(
    pair: Pair<ParkingLot, Dungeon>,
    parked: Boolean,
    onBack: () -> Unit,
    onConfirmed: (Reservation) -> Unit,
) {
    val (lot, dungeon) = pair
    val c = LocalAppContainer.current
    val repo = c.reservations
    val dims by c.session.vehicleDimensions.collectAsState()
    val scope = rememberCoroutineScope()
    var mode by remember { mutableStateOf(RunMode.CHALLENGE) }
    var sel by remember(lot.id, mode) { mutableStateOf(emptySet<Int>()) }
    var reload by remember { mutableStateOf(0) }
    var load by remember { mutableStateOf<Load>(Load.Loading) }
    var quote by remember { mutableStateOf<ReservationQuote?>(null) }
    var quoteErr by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var paying by remember { mutableStateOf(false) }
    val ready = load as? Load.Ready
    val rules = ready?.policy?.safetyRules.orEmpty()
    var checks by remember(rules) { mutableStateOf(List(rules.size) { false }) }

    LaunchedEffect(lot.id, mode, reload, dims) {
        load = Load.Loading
        val d = dims
        load = if (d == null) Load.Failed("차량 크기를 알 수 없어 예약할 수 없어요") else try {
            val policy = repo.policy(lot.id)
            when {
                !policy.currentlyAvailable -> Load.Failed("지금은 예약을 받지 않아요")
                mode.name !in policy.allowedModes -> Load.Failed("이 모드는 예약할 수 없어요")
                else -> Load.Ready(policy, repo.slots(lot.id, LocalDate.now(KST).toString(), mode, d).filter { it.endsAt.isAfter(Instant.now()) }.take(7)) // mockup 04: one row of 7 upcoming slots
            }
        } catch (e: CancellationException) { throw e } catch (e: Exception) { Load.Failed(reservationReason(e)) }
    }
    // Debounced server quote; the charged amount is never computed here.
    LaunchedEffect(lot.id, mode, sel, load) {
        quote = null; quoteErr = null
        val r = load as? Load.Ready; val d = dims
        if (r == null || d == null || sel.isEmpty()) return@LaunchedEffect
        delay(300)
        try {
            quote = repo.quote(lot.id, mode, r.slots[sel.min()].startsAt, sel.size * 30, d)
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            quoteErr = reservationReason(e)
            if (e is ApiException && e.status == 409) { sel = emptySet(); reload++ }
        }
    }

    val slots = ready?.slots.orEmpty()
    val chosen = sel.sorted().map { slots[it] }
    val range = if (chosen.isEmpty()) "-" else HM.format(chosen.first().startsAt) + "–" + HM.format(chosen.last().endsAt)
    val ok = ready != null && sel.isNotEmpty() && checks.all { it } && quote != null && !paying
    val date = remember { LocalDate.now(KST).let { "${it.monthValue}월 ${it.dayOfMonth}일 (${it.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN)})" } }
    fun x(v: Double?) = if (v == null) "" else " ×$v"

    PixelPanel(Modifier.widthIn(max = 1280.dp).fillMaxWidth(0.9f).verticalScroll(rememberScrollState()), border = PixelColors.Paper, borderWidth = 4.dp, shadow = PixelColors.Purple, padding = 32.dp) {
        Column(verticalArrangement = Arrangement.spacedBy(22.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Mono("CONFIRM 2/2", 14, PixelColors.Gold)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    repeat(2) { Box(Modifier.size(32.dp, 8.dp).background(PixelColors.Gold)) }
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Ko("${dungeon.name} · 도전 예약", 34)
                Ko("일반 이용객이 없는 개방 시간에만 예약할 수 있어요. 최소 30분 단위입니다.", 17, PixelColors.Lavender, false)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                val p = ready?.policy
                Chip("도전${x(p?.challengeMultiplier)}", mode == RunMode.CHALLENGE, parked, Modifier.weight(1f), enabled = !paying) { mode = RunMode.CHALLENGE }
                Chip("연습${x(p?.practiceMultiplier)}", mode == RunMode.PRACTICE, parked, Modifier.weight(1f), enabled = !paying) { mode = RunMode.PRACTICE }
            }
            when (val l = load) {
                Load.Loading -> Ko("예약 정보를 불러오는 중…", 18, PixelColors.Lavender, false)
                is Load.Failed -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Ko("예약 정보를 불러오지 못했어요 (${l.reason})", 20, PixelColors.Orange)
                    PixelButton("다시 시도", parkedOnly { reload++ }, Modifier.widthIn(min = 200.dp), dim = !parked)
                }
                is Load.Ready -> {
                    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Ko("$date 개방 시간", 16, PixelColors.Lavender)
                        if (l.slots.isEmpty()) Ko("오늘 남은 예약 시간이 없어요", 16, PixelColors.Lavender, false)
                        l.slots.chunked(7).forEachIndexed { row, items ->
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                items.forEachIndexed { k, s ->
                                    val i = row * 7 + k
                                    Chip("${HM.format(s.startsAt)}–${HM.format(s.endsAt)}\n잔여 ${s.remaining}", i in sel, parked, Modifier.weight(1f), mono = true, height = 72.dp, enabled = s.available && !paying) {
                                        toggleSlot(sel, i).let { if (it.size <= MAX_SLOTS) sel = it }
                                    }
                                }
                                // keep the last row's chips the same width as full rows
                                repeat(7 - items.size) { Box(Modifier.weight(1f)) }
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        PixelPanel(Modifier.weight(1f), bg = PixelColors.Bg, padding = 18.dp) {
                            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                                KV("일반 주차비", lot.fee30MinWon?.let { "30분 ${won(it)}" } ?: "정보 없음")
                                KV("P지컬 MAX 프리미엄", quote?.let { "× ${it.multiplier}" } ?: "-")
                                KV("선택 시간", if (sel.isEmpty()) "-" else "$range (${sel.size * 30}분)")
                                Box(Modifier.fillMaxWidth().height(3.dp).background(PixelColors.PanelBorder))
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Ko("선결제 금액", 17)
                                    Mono(quote?.let { won(it.amountKrw) } ?: quoteErr ?: "-", 22, PixelColors.Gold)
                                }
                            }
                        }
                        PixelPanel(Modifier.weight(1f), border = PixelColors.Orange, bg = Px.Ember, padding = 18.dp) {
                            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                Ko("안전 수칙 동의", 20, PixelColors.Orange)
                                rules.forEachIndexed { i, t ->
                                    val toggle = parkedOnly {
                                        checks = checks.toMutableList().also { it[i] = !it[i] }
                                    }
                                    Row(Modifier.alpha(if (parked) 1f else 0.4f).tap(toggle).heightIn48(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Box(Modifier.size(28.dp).border(3.dp, PixelColors.Orange).padding(4.dp).background(if (checks[i]) PixelColors.Orange else Color.Transparent))
                                        Ko(t, 16, bold = false)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            message?.let { Ko(it, 18, PixelColors.Orange) }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PixelButton("이전", parkedOnly { if (!paying) onBack() }, Modifier.widthIn(min = 200.dp), dim = !parked)
                PixelButton(
                    if (paying) "결제 중…" else "결제하고 ${if (mode == RunMode.CHALLENGE) "도전" else "연습"} 시작",
                    parkedOnly {
                        val q = quote; val r = ready
                        if (ok && q != null && r != null) {
                            paying = true; message = null
                            val minutes = sel.size * 30
                            // pressing pay with every box checked is the agreement; server accepts ±5 min, so a box ticked long ago would go stale
                            val at = Instant.now()
                            scope.launch {
                                try {
                                    val res = repo.reserve(q, r.policy.safetyRulesVersion, at)
                                    onConfirmed(Reservation(lot.id, mode, range, minutes, res.amountKrw, res.id))
                                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                                    paying = false
                                    if (e is ApiException && e.status == 409) { message = reservationReason(e); sel = emptySet(); reload++ }
                                    else message = "예약하지 못했어요 (${reservationReason(e)})"
                                }
                            }
                        }
                    },
                    Modifier.weight(1f), filled = true, dim = !parked || !ok, textSize = 24,
                )
            }
        }
    }
}

private fun Modifier.heightIn48() = this.then(Modifier.height(48.dp))

@Composable
private fun KV(k: String, v: String) = Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Ko(k, 16, PixelColors.Lavender, false); Ko(v, 16, bold = false)
}

@Composable
private fun Chip(text: String, on: Boolean, parked: Boolean, modifier: Modifier = Modifier, mono: Boolean = false, height: androidx.compose.ui.unit.Dp = 52.dp, enabled: Boolean = true, onClick: () -> Unit) {
    val click = parkedOnly { if (enabled) onClick() }
    Box(
        modifier.alpha(if (parked && enabled) 1f else 0.4f).height(height)
            .background(if (on) PixelColors.Gold else PixelColors.Panel).border(3.dp, if (on) PixelColors.Gold else PixelColors.Purple).tap(click),
        contentAlignment = Alignment.Center,
    ) {
        val fg = if (on) PixelColors.Bg else PixelColors.Paper
        if (mono) Mono(text, 15, fg, align = TextAlign.Center) else Ko(text, 18, fg, align = TextAlign.Center, modifier = Modifier.padding(horizontal = 12.dp))
    }
}

@Preview(widthDp = 1682, heightDp = 1210)
@Composable
private fun PreviewEntry() {
    val r = MockParkingRepository()
    MaxEntryContent(listOf(r.lot("daon")!! to r.dungeon("daon")!!), "daon", {}, {})
}
