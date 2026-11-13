package com.parksical.ui.general

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.parksical.LocalAppContainer
import com.parksical.domain.model.VehicleSize
import com.parksical.ui.theme.GeneralColors

fun starColor(stars: Float): Color = when {
    stars < 2.75f -> GeneralColors.Text
    stars < 3.75f -> GeneralColors.Muted
    else -> GeneralColors.Accent
}

fun fmt(f: Float) = "%.1f".format(f)

/** Pill used for filters, sort and size picker. */
@Composable
fun Pill(text: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Box(
        modifier
            .defaultMinSize(minHeight = 48.dp)
            .clip18()
            .background(if (selected) GeneralColors.Text else Color.Transparent)
            .border(BorderStroke(1.dp, if (selected) GeneralColors.Text else Color(0xFF3A404A)), RoundedCornerShape(24.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text, fontSize = 16.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
            color = if (selected) GeneralColors.Bg else GeneralColors.Text,
        )
    }
}

private fun Modifier.clip18() = this.then(Modifier.clip(RoundedCornerShape(24.dp)))

fun Modifier.dimUnless(enabled: Boolean) = if (enabled) this else this.alpha(0.4f)

/** "도전장" badge, same look in map pins, list and detail. */
@Composable
fun ChallengeBadge(modifier: Modifier = Modifier) {
    Text(
        "도전장", modifier = modifier.background(GeneralColors.Bg).border(2.dp, GeneralColors.Accent).padding(horizontal = 8.dp, vertical = 3.dp),
        color = GeneralColors.AccentSoft, fontSize = 14.sp, fontWeight = FontWeight.Bold,
    )
}

/** Vehicle size in effect: MIDSIZE until the user picks one, `picked` tells which. */
@Composable
fun mySize(): Pair<VehicleSize, Boolean> {
    val s by LocalAppContainer.current.session.vehicleSize.collectAsState()
    return (s ?: VehicleSize.MIDSIZE) to (s != null)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SizePicker(modifier: Modifier = Modifier) {
    val session = LocalAppContainer.current.session
    val (size, picked) = mySize()
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        VehicleSize.entries.forEach { v ->
            Pill(v.label, picked && v == size, { session.vehicleSize.value = v })
        }
    }
}
