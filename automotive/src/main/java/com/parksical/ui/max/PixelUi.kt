package com.parksical.ui.max

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.MissionType
import com.parksical.ui.theme.PixelColors
import com.parksical.vehicle.VehicleCapabilities
import kotlin.math.roundToInt

/** Extra pixel-theme colors taken from mockups 05-07 (PixelColors is frozen). */
internal object Px {
    val Muted = Color(0xFF6E6490)
    val Dim = Color(0xFF8E86AA)
    val Slab = Color(0xFF2E2550)
    val Line = Color(0xFF241C44)
    val Hud = Color(0xFF08060F)
    val Ember = Color(0xFF241426)
    val GoldDark = Color(0xFFB8860B)
    val Warm = Color(0xFFFFB27F)
    val Red = Color(0xFFD9412B)
    val Green = Color(0xFF7FD99A)
}

@Composable
internal fun Mono(text: String, size: Int, color: Color = PixelColors.Paper, modifier: Modifier = Modifier, align: TextAlign? = null) =
    Text(text, modifier, color, fontSize = size.sp, lineHeight = (size * 1.45f).sp, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, textAlign = align)

@Composable
internal fun Ko(text: String, size: Int, color: Color = PixelColors.Paper, bold: Boolean = true, modifier: Modifier = Modifier, align: TextAlign? = null) =
    Text(text, modifier, color, fontSize = size.sp, lineHeight = (size * 1.4f).sp, fontWeight = if (bold) FontWeight.Bold else FontWeight.Normal, textAlign = align)

/** Click without ripple (pixel look). */
internal fun Modifier.tap(onClick: () -> Unit): Modifier =
    clickable(interactionSource = MutableInteractionSource(), indication = null, onClick = onClick)

@Composable
internal fun PixelPanel(
    modifier: Modifier = Modifier,
    border: Color = PixelColors.PanelBorder,
    borderWidth: Dp = 3.dp,
    shadow: Color? = null,
    bg: Color = PixelColors.Panel,
    padding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val sh = with(LocalDensity.current) { 6.dp.toPx() }
    Column(
        modifier
            .drawBehind { if (shadow != null) drawRect(shadow, Offset(sh, sh), size) }
            .background(bg)
            .border(borderWidth, border)
            .padding(padding),
        content = content,
    )
}

/** [dim] renders at alpha 0.4 (not parked). Caller passes a parkedOnly-wrapped onClick. */
@Composable
internal fun PixelButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = false,
    dim: Boolean = false,
    height: Dp = 64.dp,
    textSize: Int = 22,
) {
    val fg = if (filled) PixelColors.Bg else PixelColors.Paper
    val sh = with(LocalDensity.current) { 6.dp.toPx() }
    Box(
        modifier
            .alpha(if (dim) 0.4f else 1f)
            .heightIn(min = height)
            .drawBehind { if (filled) drawRect(Px.GoldDark, Offset(sh, sh), size) }
            .background(if (filled) PixelColors.Gold else Color.Transparent)
            .border(4.dp, if (filled) PixelColors.Gold else PixelColors.Lavender)
            .tap(onClick),
        contentAlignment = Alignment.Center,
    ) { Ko(text, textSize, fg, modifier = Modifier.padding(horizontal = 16.dp)) }
}

internal fun DrawScope.px(color: Color, x: Float, y: Float, w: Float, h: Float) {
    val l = x.roundToInt().toFloat(); val t = y.roundToInt().toFloat()
    drawRect(color, Offset(l, t), Size((x + w).roundToInt() - l, (y + h).roundToInt() - t))
}

/** Draws a char-bitmap; characters missing from [pal] are transparent. Integer cell edges keep it crisp. */
internal fun DrawScope.sprite(rows: List<String>, pal: Map<Char, Color>, cell: Float, ox: Float = 0f, oy: Float = 0f) {
    rows.forEachIndexed { y, r -> r.forEachIndexed { x, ch -> pal[ch]?.let { px(it, ox + x * cell, oy + y * cell, cell, cell) } } }
}

private val STAR = listOf("...X...", "..XXX..", "XXXXXXX", ".XXXXX.", ".XXXXX.", ".XX.XX.", ".X...X.")
private val CAR = listOf("..llll..", "..llll..", "bbbbbbbb", "bbbbbbbb", "bbbbbbbb", ".ww..ww.")
private val P_GLYPH = listOf("XXXXXX..", "XXXXXXX.", "XX...XXX", "XX...XXX", "XX...XXX", "XXXXXXX.", "XXXXXX..", "XX......", "XX......", "XX......", "XX......", "XX......")
private val X_GLYPH = listOf("XX....XX", "XXX..XXX", ".XXXXXX.", "..XXXX..", "..XXXX..", ".XXXXXX.", "XXX..XXX", "XX....XX")
internal val GEAR_ICON = listOf("..X..", ".XXX.", "XXXXX", ".XXX.", "..X..")
internal val STEER_ICON = listOf("..X..", "..X..", "..X..", ".....", "..X..")

@Composable
internal fun PixelStars(count: Int, max: Int = 3, size: Dp = 28.dp) {
    val cellPx = with(LocalDensity.current) { (size.toPx() / 7).toInt().coerceAtLeast(1).toFloat() }
    val gap = cellPx * 2
    val w = with(LocalDensity.current) { ((cellPx * 7 + gap) * max - gap).toDp() }
    Canvas(Modifier.size(w, with(LocalDensity.current) { (cellPx * 7).toDp() })) {
        repeat(max) { i ->
            val c = if (i < count) PixelColors.Gold else Px.Slab
            sprite(STAR, mapOf('X' to c), cellPx, i * (cellPx * 7 + gap))
        }
    }
}

@Composable
internal fun PixelCar(modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val cell = size.width / 8f
        sprite(CAR, mapOf('b' to PixelColors.Orange, 'l' to Px.Warm, 'w' to PixelColors.Paper), cell)
    }
}

/** 28x28 stamp. Cleared = red ring + P + gold sparks; otherwise grey ring + X. */
@Composable
internal fun PixelStamp(cleared: Boolean, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val cell = size.width / 28f
        val col = if (cleared) Px.Red else Px.Muted
        for (y in 0 until 28) for (x in 0 until 28) {
            val d = kotlin.math.hypot(x + .5f - 14f, y + .5f - 14f)
            if (d in 11f..13.2f) px(col, x * cell, y * cell, cell, cell)
        }
        if (cleared) {
            sprite(P_GLYPH, mapOf('X' to col), cell, 10 * cell, 8 * cell)
            listOf(7 to 18, 13 to 21, 19 to 18).forEach { (x, y) -> px(PixelColors.Gold, x * cell, y * cell, 2 * cell, 2 * cell) }
        } else sprite(X_GLYPH, mapOf('X' to col), cell, 10 * cell, 10 * cell)
    }
}

internal fun mmss(ms: Long): String {
    val s = (ms.coerceAtLeast(0) / 1000).toInt()
    return "%02d:%02d".format(s / 60, s % 60)
}

internal fun won(n: Int): String = "%,d원".format(n)

/** Mission inputs a car must provide; unsupported missions are shown greyed / skipped. */
internal fun MissionType.supported(c: VehicleCapabilities): Boolean = when (this) {
    MissionType.SPIRAL_NO_STOP -> c.speed
    MissionType.PILLAR_SMOOTH -> c.speed && c.steering
    MissionType.REVERSE_PARK_ONE_SHOT -> c.gear
}

/** A CHALLENGE record counts as a stamp only when every stage was judged (aborted partials have fewer). */
internal fun RunRecord.cleared(@Suppress("UNUSED_PARAMETER") dungeon: Dungeon?): Boolean = cleared

internal fun stampsOf(base: Int, records: List<RunRecord>, dungeonOf: (String) -> Dungeon?): Int =
    base + records.count { it.mode == RunMode.CHALLENGE && it.cleared(dungeonOf(it.lotId)) }

/** Full-screen panel for "not parked" on result screens. */
@Composable
internal fun NeedParkPanel() {
    Box(Modifier.fillMaxSize().background(PixelColors.Bg), contentAlignment = Alignment.Center) {
        PixelPanel(border = PixelColors.Paper, shadow = PixelColors.Purple, borderWidth = 4.dp, padding = 40.dp) {
            Ko("정차하면 결과를 보여드려요", 34, PixelColors.Gold, align = TextAlign.Center, modifier = Modifier.fillMaxWidth())
            Ko("주행 중에는 결과·도장·리포트가 표시되지 않아요", 18, PixelColors.Lavender, false, Modifier.padding(top = 12.dp))
        }
    }
}
