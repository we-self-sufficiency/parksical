package com.parksical

import android.content.Context
import com.parksical.data.DataMode
import com.parksical.data.FallbackParkingRepository
import com.parksical.data.MockParkingRepository
import com.parksical.data.MockReservationRepository
import com.parksical.data.ModeReservationRepository
import com.parksical.data.ParkedLocationSync
import com.parksical.data.ParkingRepository
import com.parksical.data.remote.ApiClient
import com.parksical.data.remote.AuthRepository
import com.parksical.data.remote.ServerParkedLocationSync
import com.parksical.data.remote.ServerParkingRepository
import com.parksical.data.remote.ReservationRepository
import com.parksical.data.remote.ServerReservationRepository
import com.parksical.data.remote.ServerRunSync
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
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** Manual DI. Everything here lives as long as the process, so MAX judging survives the UI going to background. */
class AppContainer(context: Context) {
    private val mockParking = MockParkingRepository()
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    val vehicle: VehicleSource = PleosVehicleSource(context)
    val navi: NaviGateway = PleosNaviGateway(context)
    val api = ApiClient(BuildConfig.PARKSICAL_API_BASE_URL)
    val auth = AuthRepository(context, api)
    private val fallback = FallbackParkingRepository(ServerParkingRepository(api, auth), mockParking, appScope) { drive.activeRun != null }
    val parking: ParkingRepository = fallback
    /** Server unless unreachable; the UI shows a "목업 데이터" badge while Mock. */
    val dataMode: StateFlow<DataMode> = fallback.mode
    val reservations: ReservationRepository = ModeReservationRepository({ dataMode.value }, ServerReservationRepository(api, auth), MockReservationRepository(mockParking))
    val parkedSync: ParkedLocationSync = ServerParkedLocationSync(api, auth)
    val session = SessionStore()
    val difficulty: DifficultyCalculator = DefaultDifficultyCalculator()
    val judge: MissionJudge = DefaultMissionJudge()
    val spotEstimator: ParkingSpotEstimator = DefaultParkingSpotEstimator()

    val drive = DriveCoordinator(appScope, vehicle, navi, parking, session, difficulty, judge, spotEstimator, parkedSync, ServerRunSync(api, auth), { dataMode.value is DataMode.Mock }) { active ->
        runCatching { RunKeepAliveService.set(context.applicationContext, active) }
    }

    /** "서버 다시 연결" button. */
    fun retryServer() { appScope.launch { parking.refresh(session.vehicleDimensions.value) } }
}
