package com.parksical.data

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.domain.model.Reservation
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * Lots near the destination. Real implementation: `ServerParkingRepository` (parksical-server `GET /lots`,
 * `GET /lots/{id}`), falling back to [MockParkingRepository] data when the server is unreachable or the
 * endpoint is not implemented yet. Dungeons have no server contract yet, so they always come from mock data.
 */
interface ParkingRepository {
    val destinationName: String
    val destinationLat: Double
    val destinationLng: Double

    /** Current list for the map/list screens; collect this in UI. */
    val lots: StateFlow<List<ParkingLot>>
    val status: StateFlow<LotsStatus>

    /** Re-query around the destination. [dimensions] = car size for the server's VEHICLE_ADJUSTED score. */
    suspend fun refresh(dimensions: VehicleDimensions?)

    /** Cached lot (from the last list or detail). */
    fun lot(id: String): ParkingLot?

    /** Fetches `GET /lots/{id}` (structure, navigation point) and updates the cache; returns cached on failure. */
    suspend fun loadDetail(id: String, dimensions: VehicleDimensions?): ParkingLot?

    fun dungeon(lotId: String): Dungeon?
}

sealed interface LotsStatus {
    data object Loading : LotsStatus
    data object Server : LotsStatus
    /** Showing mock data; [reason] is short Korean text for a small banner, e.g. "서버 연결 안 됨". */
    data class Fallback(val reason: String) : LotsStatus
}

/** Uploads the parked spot (`POST /parked-locations`) and user corrections (`PATCH`). Never throws. */
interface ParkedLocationSync {
    /** Returns the spot with serverId/serverVersion/sync filled in (sync=FAILED or LOCAL_ONLY on failure). */
    suspend fun upload(spot: ParkingSpotEstimate, lot: ParkingLot?): ParkingSpotEstimate
    suspend fun correct(spot: ParkingSpotEstimate, lot: ParkingLot?): ParkingSpotEstimate
}

/**
 * Everything the user produced: size choice, saved spot, reservation, MAX records.
 * shortcut: in-memory only, lost on process death; move to DataStore/Room when a server exists.
 */
class SessionStore {
    /** Null until read from INFO_EXTERIOR_DIMENSIONS or picked by the user. */
    val vehicleSize = MutableStateFlow<VehicleSize?>(null)
    /** Raw INFO_EXTERIOR_DIMENSIONS, sent to the server as lengthMm/widthMm. Null if unknown. */
    val vehicleDimensions = MutableStateFlow<VehicleDimensions?>(null)
    val savedSpot = MutableStateFlow<ParkingSpotEstimate?>(null)
    val reservation = MutableStateFlow<Reservation?>(null)

    /** Lot the user started route guidance to; an arrival event refers to this lot. */
    val navigatingLotId = MutableStateFlow<String?>(null)

    private val _records = MutableStateFlow<List<RunRecord>>(emptyList())
    val records: StateFlow<List<RunRecord>> = _records

    /** Mock history so the stamp count matches the mockup ("도장 7개째"). */
    val baseStamps = 6

    fun addRecord(record: RunRecord) = _records.update { it + record }
}
