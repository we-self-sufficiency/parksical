package com.parksical.ui.max

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import com.parksical.domain.model.RunMode
/** Phase 0 placeholder. Owner: agent D. Keep this signature; it is called from nav/AppNavHost.kt. */
@Composable
fun StageScreen(lotId: String, mode: RunMode, onExitToGeneral: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("스테이지 맵 / HUD") }
}
