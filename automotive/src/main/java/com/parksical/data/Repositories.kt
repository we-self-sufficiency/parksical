package com.parksical.data

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.domain.model.Reservation
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.VehicleSize
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/** Server stand-in for the contest stage: lots, dungeons and the destination are mock data. */
interface ParkingRepository {
    val destinationName: String
    val destinationLat: Double
    val destinationLng: Double
    fun lots(): List<ParkingLot>
    fun lot(id: String): ParkingLot?
    fun dungeon(lotId: String): Dungeon?
}

/**
 * Everything the user produced: size choice, saved spot, reservation, MAX records.
 * shortcut: in-memory only, lost on process death; move to DataStore/Room when a server exists.
 */
class SessionStore {
    /** Null until read from INFO_EXTERIOR_DIMENSIONS or picked by the user. */
    val vehicleSize = MutableStateFlow<VehicleSize?>(null)
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
