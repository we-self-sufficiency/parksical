package com.parksical.data.remote

import com.parksical.data.ParkedLocationSync
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.domain.model.ServerStructure
import com.parksical.domain.model.SyncState
import org.json.JSONObject
import java.time.Instant

/** Server `confidence` enum from the local 0..1 estimate. */
fun confidenceOf(c: Float): String = when {
    c >= 0.75f -> "HIGH"
    c >= 0.5f -> "MEDIUM"
    c > 0f -> "LOW"
    else -> "UNKNOWN"
}

fun rfc3339Utc(epochMs: Long): String = Instant.ofEpochMilli(epochMs).toString()

/** floorId/zoneId/structureVersion for a spot; zone is dropped when the floor is unknown. */
data class LocationIds(val floorId: String?, val zoneId: String?, val structureVersion: String?)

fun locationIds(spot: ParkingSpotEstimate, structure: ServerStructure?): LocationIds {
    val floor = structure?.floors?.firstOrNull { it.label == spot.floor } ?: return LocationIds(null, null, null)
    val zone = floor.zoneIds.firstOrNull { it == spot.zone }
        ?: floor.zoneIds.firstOrNull { it.endsWith(spot.zone) }
    return LocationIds(floor.id, zone, structure.version)
}

class ServerParkedLocationSync(private val api: ApiClient, private val auth: AuthRepository) : ParkedLocationSync {

    override suspend fun upload(spot: ParkingSpotEstimate, lot: ParkingLot?): ParkingSpotEstimate {
        val token = auth.accessToken() ?: return spot.copy(sync = SyncState.LOCAL_ONLY)
        val ids = locationIds(spot, lot?.serverStructure)
        val body = JSONObject()
            .put("clientRecordId", spot.clientRecordId)
            .put("lotId", spot.lotId)
            .put("floorId", ids.floorId ?: JSONObject.NULL)
            .put("zoneId", ids.zoneId ?: JSONObject.NULL)
            .put("confidence", confidenceOf(spot.confidence))
            .put("distanceM", JSONObject.NULL)
            .put("occurredAt", rfc3339Utc(spot.occurredAtEpochMs))
            .put("structureVersion", ids.structureVersion ?: JSONObject.NULL)
        return try {
            val r = api.request("POST", "/parked-locations", body = body, bearer = token, idempotencyKey = spot.clientRecordId)
            applyLocation(spot, r.body)
        } catch (e: Exception) {
            spot.copy(sync = SyncState.FAILED)
        }
    }

    override suspend fun correct(spot: ParkingSpotEstimate, lot: ParkingLot?): ParkingSpotEstimate {
        val id = spot.serverId ?: return upload(spot, lot)
        val token = auth.accessToken() ?: return spot.copy(sync = SyncState.LOCAL_ONLY)
        val ids = locationIds(spot, lot?.serverStructure)
        var version = spot.serverVersion ?: return spot.copy(sync = SyncState.FAILED)
        suspend fun patch(v: Int) = api.request(
            "PATCH", "/parked-locations/$id",
            body = JSONObject().put("expectedVersion", v)
                .put("floorId", ids.floorId ?: JSONObject.NULL)
                .put("zoneId", ids.zoneId ?: JSONObject.NULL),
            bearer = token, idempotencyKey = spot.clientRecordId + "-v" + v,
        )
        return try {
            val r = try {
                patch(version)
            } catch (e: ApiException) {
                if (e.code != "VERSION_CONFLICT") throw e
                version = api.request("GET", "/parked-locations/$id", bearer = token).body!!.getInt("version")
                patch(version)
            }
            applyLocation(spot, r.body)
        } catch (e: Exception) {
            spot.copy(sync = SyncState.FAILED)
        }
    }

    private fun applyLocation(spot: ParkingSpotEstimate, body: JSONObject?): ParkingSpotEstimate =
        if (body == null) spot.copy(sync = SyncState.FAILED)
        else spot.copy(serverId = body.getString("id"), serverVersion = body.getInt("version"), sync = SyncState.SYNCED)
}
