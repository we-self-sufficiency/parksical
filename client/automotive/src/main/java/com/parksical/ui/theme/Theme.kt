package com.parksical.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** General mode: Pleos Connect dark tone (docs/mockups/01, 02). */
object GeneralColors {
    val Bg = Color(0xFF0E1013)
    val Header = Color(0xFF121418)
    val Map = Color(0xFF14171B)
    val Surface = Color(0xFF1C2026)
    val Border = Color(0xFF262A31)
    val Text = Color(0xFFF2F4F6)
    val TextSub = Color(0xFFA9B0BA)
    val Muted = Color(0xFFC9CED6)
    val Accent = Color(0xFFFF8A3D)   // hard / challenge
    val AccentSoft = Color(0xFFFFB27F)
    val Link = Color(0xFF4C9BFF)
}

/** P지컬 MAX: 8-bit retro pixel tone (docs/mockups/05, 06, 07). */
object PixelColors {
    val Bg = Color(0xFF120D24)
    val BgDeep = Color(0xFF0B0818)
    val Panel = Color(0xFF1B1430)
    val PanelBorder = Color(0xFF3B2F66)
    val Purple = Color(0xFF5B4BB7)
    val Lavender = Color(0xFFCFC6E8)
    val Paper = Color(0xFFF7F1E3)
    val Gold = Color(0xFFFFD23F)
    val Orange = Color(0xFFFF8A3D)
}

enum class UiMode { GENERAL, MAX }

val LocalUiMode = staticCompositionLocalOf { UiMode.GENERAL }

@Composable
fun ParksicalTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = GeneralColors.Text,
            onPrimary = GeneralColors.Bg,
            secondary = GeneralColors.Accent,
            background = GeneralColors.Bg,
            onBackground = GeneralColors.Text,
            surface = GeneralColors.Surface,
            onSurface = GeneralColors.Text,
            onSurfaceVariant = GeneralColors.TextSub,
            outline = GeneralColors.Border,
        ),
        content = content,
    )
}
