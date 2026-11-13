package com.parksical.data.remote

import com.parksical.data.LotsStatus
import com.parksical.data.MockParkingRepository
import com.parksical.data.ParkingRepository
import com.parksical.domain.model.ParkingLot
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.flow.StateFlow

/** Phase-2 stub. Owner: agent E (server integration). Delegates to mock until implemented. */
class ServerParkingRepository(private val api: ApiClient, private val mock: MockParkingRepository) : ParkingRepository {
    override val destinationName get() = mock.destinationName
    override val destinationLat get() = mock.destinationLat
    override val destinationLng get() = mock.destinationLng
    override val lots: StateFlow<List<ParkingLot>> get() = mock.lots
    override val status: StateFlow<LotsStatus> get() = mock.status
    override suspend fun refresh(dimensions: VehicleDimensions?) {}
    override fun lot(id: String) = mock.lot(id)
    override suspend fun loadDetail(id: String, dimensions: VehicleDimensions?) = mock.lot(id)
    override fun dungeon(lotId: String) = mock.dungeon(lotId)
}
