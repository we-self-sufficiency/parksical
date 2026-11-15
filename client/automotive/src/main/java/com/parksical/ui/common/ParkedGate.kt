package com.parksical.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import com.parksical.vehicle.VehicleState

/** Current vehicle state for every screen. Provided once in MainActivity. */
val LocalVehicleState = compositionLocalOf { VehicleState() }

/** Shows "정차 후 이용할 수 있어요". Provided once in MainActivity (snackbar). */
val LocalShowBlockedNotice = compositionLocalOf<() -> Unit> { {} }

/**
 * Safety rule: mode switch, 도전장, confirm and payment only work in P.
 * Wrap the onClick: `onClick = parkedOnly { ... }`. While driving the click only shows the notice,
 * and callers should also render the control dimmed (alpha 0.4) using [LocalVehicleState].isParked.
 */
@Composable
fun parkedOnly(action: () -> Unit): () -> Unit {
    val parked = LocalVehicleState.current.isParked
    val notice = LocalShowBlockedNotice.current
    return if (parked) action else notice
}
