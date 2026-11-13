package com.parksical

import android.content.Context
import com.parksical.data.MockParkingRepository
import com.parksical.data.ParkingRepository
import com.parksical.data.SessionStore
import com.parksical.domain.engine.DefaultDifficultyCalculator
import com.parksical.domain.engine.DefaultMissionJudge
import com.parksical.domain.engine.DefaultParkingSpotEstimator
import com.parksical.domain.engine.DifficultyCalculator
import com.parksical.domain.engine.MissionJudge
import com.parksical.domain.engine.ParkingSpotEstimator
import com.parksical.navi.NaviGateway
import com.parksical.navi.PleosNaviGateway
import com.parksical.vehicle.PleosVehicleSource
import com.parksical.vehicle.VehicleSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.Dispatchers

/** Manual DI. Everything here lives as long as the process, so MAX judging survives the UI going to background. */
class AppContainer(context: Context) {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val vehicle: VehicleSource = PleosVehicleSource(context)
    val navi: NaviGateway = PleosNaviGateway(context)
    val parking: ParkingRepository = MockParkingRepository()
    val session = SessionStore()
    val difficulty: DifficultyCalculator = DefaultDifficultyCalculator()
    val judge: MissionJudge = DefaultMissionJudge()
    val spotEstimator: ParkingSpotEstimator = DefaultParkingSpotEstimator()

    val drive = DriveCoordinator(appScope, vehicle, navi, parking, session, difficulty, judge, spotEstimator)
}
