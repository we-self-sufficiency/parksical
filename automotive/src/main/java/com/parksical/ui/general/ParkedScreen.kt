package com.parksical.ui.general

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier

/** Phase 0 placeholder. Owner: agent C. Keep this signature; it is called from nav/AppNavHost.kt. */
@Composable
fun ParkedScreen(onDone: () -> Unit) {
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("주차 위치") }
}
