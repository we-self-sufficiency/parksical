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

/** UTC "Z" with at most 3 fractional digits (ms precision). */
fun rfc3339Utc(epochMs: Long): String = Instant.ofEpochMilli(epochMs).toString()

/** floorId/zoneId/structureVersion for a spot; zone is dropped when the floor is unknown. */
data class LocationIds(val floorId: String?, val zoneId: String?, val structureVersion: String?) {
    /** Server wants an int; null when non-numeric (then the whole chain is null). */
    val version: Int? get() = structureVersion?.toIntOrNull()
}

fun locationIds(spot: ParkingSpotEstimate, structure: ServerStructure?): LocationIds {
    val level = levelOf(spot.floor)
    val floor = structure?.floors?.firstOrNull { it.label == spot.floor || (level != null && it.level == level) }
        ?: return LocationIds(null, null, null)
    val zone = floor.zones.firstOrNull { it.label == spot.zone } ?: floor.zones.firstOrNull { it.label.endsWith(spot.zone) }
    return LocationIds(floor.id, zone?.id, structure.version)
}

/** "B2" -> -2, "1F" -> 0 (1F is ground level); null when unparseable. */
fun levelOf(floor: String): Int? {
    Regex("^B(\\d+)$").find(floor)?.let { return -it.groupValues[1].toInt() }
    return Regex("^(\\d+)F$").find(floor)?.let { it.groupValues[1].toInt() - 1 }
}

// Plain maps (null = JSON null) so the null-chain/field rules are unit-testable without org.json.
private fun idFields(ids: LocationIds): Map<String, Any?> {
    // null-chain: no int version => nothing below it may be sent
    val v = ids.version
    return mapOf(
        "structureVersion" to v,
        "floorId" to if (v != null) ids.floorId else null,
        "zoneId" to if (v != null && ids.floorId != null) ids.zoneId else null,
        "parkingSpaceId" to null, // estimator has no space id
    )
}

private fun noteField(spot: ParkingSpotEstimate): Map<String, Any?> =
    spot.memo?.takeIf { it.isNotBlank() }?.let { mapOf("note" to it.take(1000)) } ?: emptyMap()

/** Exactly the S-09 LocationCreate fields. */
fun createFields(spot: ParkingSpotEstimate, ids: LocationIds): Map<String, Any?> =
    mapOf("clientRecordId" to spot.clientRecordId, "lotId" to spot.lotId) + idFields(ids) + mapOf(
        "confidence" to confidenceOf(spot.confidence),
        "distanceM" to null,
        "occurredAt" to rfc3339Utc(spot.occurredAtEpochMs),
        "source" to "SYNTHETIC",
    ) + noteField(spot)

/** LocationPatch: expectedVersion + selection (+ note when set). */
fun patchFields(spot: ParkingSpotEstimate, ids: LocationIds, expectedVersion: Int): Map<String, Any?> =
    mapOf("expectedVersion" to expectedVersion) + idFields(ids) + noteField(spot)

private fun Map<String, Any?>.toJson() = JSONObject().also { j -> forEach { (k, v) -> j.put(k, v ?: JSONObject.NULL) } }

class ServerParkedLocationSync(private val api: ApiClient, private val auth: AuthRepository) : ParkedLocationSync {

    /** Bearer call; one retry with a fresh token after a 401. Null token => null (caller keeps spot local). */
    private suspend fun authed(call: suspend (String) -> ApiResponse): ApiResponse? {
        val token = auth.accessToken() ?: return null
        return try {
            call(token)
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            auth.invalidate()
            call(auth.accessToken() ?: return null)
        }
    }

    private fun failed(spot: ParkingSpotEstimate, e: Exception): ParkingSpotEstimate =
        // policy off / unknown lot / bad structure ref will not fix itself by retrying
        if (e is ApiException && (e.status == 403 || e.status == 404 || e.status == 422)) spot.copy(sync = SyncState.LOCAL_ONLY)
        else spot.copy(sync = SyncState.FAILED)

    override suspend fun upload(spot: ParkingSpotEstimate, lot: ParkingLot?): ParkingSpotEstimate {
        val body = createFields(spot, locationIds(spot, lot?.serverStructure)).toJson()
        return try {
            val r = authed { api.request("POST", "/parked-locations", body = body, bearer = it, idempotencyKey = spot.clientRecordId) }
                ?: return spot.copy(sync = SyncState.LOCAL_ONLY)
            applyLocation(spot, r.body)
        } catch (e: Exception) {
            failed(spot, e)
        }
    }

    override suspend fun correct(spot: ParkingSpotEstimate, lot: ParkingLot?): ParkingSpotEstimate {
        val id = spot.serverId ?: return upload(spot, lot)
        val ids = locationIds(spot, lot?.serverStructure)
        val version = spot.serverVersion ?: return spot.copy(sync = SyncState.FAILED)
        // key is bound to the body hash server-side, so include it: same edit replays, a different edit gets a new key
        suspend fun patch(v: Int): ApiResponse? {
            val b = patchFields(spot, ids, v).toJson()
            val key = "p-" + b.toString().hashCode().toUInt().toString(16) + "-" + spot.clientRecordId.take(40) + "-v" + v
            return authed { api.request("PATCH", "/parked-locations/$id", body = b, bearer = it, idempotencyKey = key.take(64)) }
        }
        return try {
            val r = try {
                patch(version)
            } catch (e: ApiException) {
                if (e.code != "VERSION_CONFLICT") throw e
                val fresh = authed { api.request("GET", "/parked-locations/$id", bearer = it) }?.body?.getInt("version")
                    ?: return spot.copy(sync = SyncState.FAILED)
                patch(fresh)
            } ?: return spot.copy(sync = SyncState.LOCAL_ONLY)
            applyLocation(spot, r.body)
        } catch (e: Exception) {
            failed(spot, e)
        }
    }

    /** Receipt: {locationId, version, deleted, accessEpoch}. */
    private fun applyLocation(spot: ParkingSpotEstimate, body: JSONObject?): ParkingSpotEstimate =
        if (body == null || body.optBoolean("deleted")) spot.copy(sync = SyncState.FAILED)
        else spot.copy(serverId = body.getString("locationId"), serverVersion = body.getInt("version"), sync = SyncState.SYNCED)
}
