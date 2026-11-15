package com.parksical.data

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.ParkingLot
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn

/** Where the lots come from. Mock = demo data because the server is unreachable; the UI must say so. */
sealed interface DataMode {
    data object Server : DataMode
    data class Mock(val reason: String) : DataMode
}

/** Only these two server failures mean "no backend": everything else (empty result, 5xx, 404...) stays a server state. */
private val OFFLINE_REASONS = setOf("서버 연결 안 됨", "서버 인증 안 됨")

/** Mode after a server refresh finished with [status]. Never mixes: the whole list is server or mock. */
fun modeFor(status: LotsStatus): DataMode =
    (status as? LotsStatus.Error)?.reason?.takeIf { it in OFFLINE_REASONS }?.let { DataMode.Mock(it) } ?: DataMode.Server

/**
 * Tries [server] on every refresh and falls back to [mock] when it is unreachable or login is impossible;
 * the next successful refresh goes back to the server. [runActive] freezes everything: a MAX run never sees its data swapped.
 */
class FallbackParkingRepository(
    private val server: ParkingRepository,
    private val mock: ParkingRepository,
    scope: CoroutineScope,
    private val runActive: () -> Boolean = { false },
) : ParkingRepository {
    private val _mode = MutableStateFlow<DataMode>(DataMode.Server)
    val mode: StateFlow<DataMode> = _mode
    private val isMock get() = _mode.value is DataMode.Mock
    private val active get() = if (isMock) mock else server

    override val destinationName get() = server.destinationName
    override val destinationLat get() = server.destinationLat
    override val destinationLng get() = server.destinationLng

    override val lots: StateFlow<List<ParkingLot>> =
        combine(_mode, server.lots, mock.lots) { m, s, d -> if (m is DataMode.Mock) d else s }
            .stateIn(scope, SharingStarted.Eagerly, server.lots.value)
    // Mock data is a normal "loaded" list (the badge explains it), not an error banner.
    override val status: StateFlow<LotsStatus> =
        combine(_mode, server.status) { m, s -> if (m is DataMode.Mock) LotsStatus.Server else s }
            .stateIn(scope, SharingStarted.Eagerly, server.status.value)

    override suspend fun refresh(dimensions: VehicleDimensions?) {
        if (runActive()) return // shortcut: skipped (not queued) during a run; the user retries after it ends
        server.refresh(dimensions)
        _mode.value = modeFor(server.status.value)
    }

    override fun lot(id: String) = active.lot(id)
    override suspend fun loadDetail(id: String, dimensions: VehicleDimensions?) = active.loadDetail(id, dimensions)
    override fun dungeon(lotId: String): Dungeon? = active.dungeon(lotId)
}
