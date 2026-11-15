package com.parksical.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.parksical.DriveCoordinator
import com.parksical.LocalAppContainer
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunStatus
import com.parksical.ui.general.HomeScreen
import com.parksical.ui.general.LotDetailScreen
import com.parksical.ui.general.ParkedScreen
import com.parksical.ui.max.MaxEntryDialogs
import com.parksical.ui.max.PracticeReportScreen
import com.parksical.ui.max.ResultScreen
import com.parksical.ui.max.StageScreen

/** Sentinel for "entry dialogs closed"; null lotId means entered from the header mode toggle. */
private object Closed

@Composable
fun AppNavHost(nav: NavHostController = rememberNavController()) {
    val container = LocalAppContainer.current
    var maxEntry by remember { mutableStateOf<Any?>(Closed) }
    val openEntry: (String?) -> Unit = { lotId ->
        // A run in progress owns the MAX flow: go back to its stage screen instead of reserving again.
        val run = container.drive.activeRun
        if (run != null) nav.navigate(Routes.maxStage(run.first, run.second)) { popUpTo(Routes.HOME) } else maxEntry = lotId
    }

    LaunchedEffect(Unit) {
        container.drive.events.collect { e ->
            when (e) {
                DriveCoordinator.Event.Parked -> nav.navigate(Routes.PARKED)
                is DriveCoordinator.Event.RunEnded -> {
                    val record = when (val s = e.status) {
                        is RunStatus.Finished -> s.record
                        is RunStatus.Aborted -> s.partial
                        else -> return@collect
                    }
                    nav.navigate(
                        if (record.mode == RunMode.PRACTICE) Routes.practiceReport(record.lotId) else Routes.MAX_RESULT
                    ) { popUpTo(Routes.HOME) }
                }
            }
        }
    }

    val home: () -> Unit = { nav.popBackStack(Routes.HOME, inclusive = false) }

    NavHost(nav, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(onOpenLot = { nav.navigate(Routes.lotDetail(it)) }, onOpenMaxEntry = openEntry)
        }
        composable(Routes.LOT_DETAIL) { entry ->
            LotDetailScreen(
                lotId = entry.arguments?.getString("lotId").orEmpty(),
                onBack = { nav.popBackStack() },
                onOpenMaxEntry = openEntry,
            )
        }
        composable(Routes.PARKED) { ParkedScreen(onDone = home) }
        composable(Routes.MAX_STAGE) { entry ->
            StageScreen(
                lotId = entry.arguments?.getString("lotId").orEmpty(),
                mode = RunMode.valueOf(entry.arguments?.getString("mode") ?: RunMode.CHALLENGE.name),
                onExitToGeneral = home,
            )
        }
        composable(Routes.MAX_RESULT) { ResultScreen(onBackToGeneral = home) }
        composable(Routes.MAX_PRACTICE_REPORT) { entry ->
            val lotId = entry.arguments?.getString("lotId").orEmpty()
            PracticeReportScreen(
                lotId = lotId,
                onPracticeAgain = { nav.navigate(Routes.maxStage(lotId, RunMode.PRACTICE)) { popUpTo(Routes.HOME) } },
                onBookChallenge = { maxEntry = lotId },
                onBackToGeneral = home,
            )
        }
    }

    if (maxEntry !== Closed) {
        MaxEntryDialogs(
            lotId = maxEntry as String?,
            onDismiss = { maxEntry = Closed },
            onConfirmed = { r ->
                container.session.reservation.value = r
                // A new booking starts clean; otherwise the stage screen shows the previous run's abort and "다시 시작".
                container.judge.reset()
                maxEntry = Closed
                nav.navigate(Routes.maxStage(r.lotId, r.mode)) { popUpTo(Routes.HOME) }
            },
        )
    }
}
