package com.parksical

import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.parksical.data.DataMode
import com.parksical.nav.AppNavHost
import com.parksical.ui.common.LocalMockInfo
import com.parksical.ui.common.MockInfo
import com.parksical.ui.common.LocalShowBlockedNotice
import com.parksical.ui.common.LocalVehicleState
import com.parksical.ui.theme.ParksicalTheme
import com.parksical.vehicle.DebugSpeedPanel
import kotlinx.coroutines.launch

val LocalAppContainer = staticCompositionLocalOf<AppContainer> { error("AppContainer not provided") }

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val container = (application as ParksicalApp).container
        // CAR_SPEED is a dangerous permission: without a runtime grant the speed property is unavailable and every
        // MAX stage shows as unsupported. Re-register vehicle inputs once it is granted.
        if (checkSelfPermission(CAR_SPEED) != PackageManager.PERMISSION_GRANTED) {
            registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
                if (granted) { container.vehicle.stop(); container.vehicle.start() }
            }.launch(CAR_SPEED)
        }
        setContent {
            val vehicleState by container.vehicle.state.collectAsStateWithLifecycle()
            val mode by container.dataMode.collectAsStateWithLifecycle()
            val mockInfo = (mode as? DataMode.Mock)?.let { m -> MockInfo(m.reason) { container.retryServer() } }
            val snackbar = remember { SnackbarHostState() }
            val scope = rememberCoroutineScope()
            val showBlocked: () -> Unit = {
                scope.launch {
                    snackbar.currentSnackbarData?.dismiss()
                    snackbar.showSnackbar("정차 후 이용할 수 있어요")
                }
            }
            ParksicalTheme {
                CompositionLocalProvider(
                    LocalAppContainer provides container,
                    LocalVehicleState provides vehicleState,
                    LocalShowBlockedNotice provides showBlocked,
                    LocalMockInfo provides mockInfo,
                ) {
                    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
                        Box(Modifier.fillMaxSize()) {
                            AppNavHost()
                            if (BuildConfig.DEBUG) DebugSpeedPanel()
                        }
                    }
                }
            }
        }
    }
}

private const val CAR_SPEED = "android.car.permission.CAR_SPEED"
