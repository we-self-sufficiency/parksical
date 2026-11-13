package com.parksical.data.remote

import com.parksical.data.ParkedLocationSync
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate

/** Phase-2 stub. Owner: agent E (server integration). */
class ServerParkedLocationSync(private val api: ApiClient, private val auth: AuthRepository) : ParkedLocationSync {
    override suspend fun upload(spot: ParkingSpotEstimate, lot: ParkingLot?) = spot
    override suspend fun correct(spot: ParkingSpotEstimate, lot: ParkingLot?) = spot
}
