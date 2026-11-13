package com.parksical.data.remote

import com.parksical.data.LotsStatus
import com.parksical.data.MockParkingRepository
import com.parksical.data.ParkingRepository
import com.parksical.domain.model.DifficultyFactor
import com.parksical.domain.model.LotSource
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ServerDifficulty
import com.parksical.domain.model.ServerFloor
import com.parksical.domain.model.ServerStructure
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

class ServerParkingRepository(private val api: ApiClient, private val mock: MockParkingRepository) : ParkingRepository {
    override val destinationName get() = mock.destinationName
    override val destinationLat get() = mock.destinationLat
    override val destinationLng get() = mock.destinationLng

    private val _lots = MutableStateFlow(mock.lots.value)
    override val lots: StateFlow<List<ParkingLot>> = _lots
    private val _status = MutableStateFlow<LotsStatus>(LotsStatus.Loading)
    override val status: StateFlow<LotsStatus> = _status

    override suspend fun refresh(dimensions: VehicleDimensions?) {
        _status.value = LotsStatus.Loading
        try {
            val out = mutableListOf<ParkingLot>()
            var cursor: String? = null
            for (page in 1..MAX_PAGES) {
                val q = linkedMapOf(
                    "lat" to destinationLat.toString(), "lng" to destinationLng.toString(),
                    "radiusM" to "1000", "limit" to "50", "sort" to "DISTANCE",
                )
                dimensions?.let { q["lengthMm"] = it.lengthMm.toString(); q["widthMm"] = it.widthMm.toString() }
                cursor?.let { q["cursor"] = it }
                val body = api.request("GET", "/lots", query = q).body!!
                val items = body.getJSONArray("items")
                for (i in 0 until items.length()) out += mergeMock(parseLot(items.getJSONObject(i)))
                cursor = if (body.isNull("nextCursor")) null else body.optString("nextCursor").takeIf { it.isNotEmpty() }
                if (cursor == null) break
            }
            _lots.value = out
            _status.value = LotsStatus.Server
        } catch (e: Exception) {
            _lots.value = mock.lots.value
            _status.value = LotsStatus.Fallback(fallbackReason(e))
        }
    }

    override fun lot(id: String) = _lots.value.find { it.id == id }

    override suspend fun loadDetail(id: String, dimensions: VehicleDimensions?): ParkingLot? {
        val cached = lot(id)
        if (cached?.source != LotSource.SERVER) return cached
        return try {
            val q = dimensions?.let { mapOf("lengthMm" to it.lengthMm.toString(), "widthMm" to it.widthMm.toString()) }.orEmpty()
            val d = api.request("GET", "/lots/$id", query = q).body!!
            val fresh = parseLot(d.getJSONObject("lot"))
            val nav = d.getJSONObject("navigationDestination")
            val s = d.optJSONObject("structure")
            val updated = cached.copy(
                serverDifficulty = fresh.serverDifficulty,
                distanceM = fresh.distanceM,
                serverStructure = s?.let {
                    val fl = it.getJSONArray("floors")
                    ServerStructure(it.getString("version"), (0 until fl.length()).map { i ->
                        val f = fl.getJSONObject(i)
                        val z = f.getJSONArray("zoneIds")
                        ServerFloor(f.getString("id"), f.getString("label"), (0 until z.length()).map(z::getString))
                    })
                },
                navigationLat = nav.getDouble("lat"), navigationLng = nav.getDouble("lng"),
            )
            _lots.value = _lots.value.map { if (it.id == id) updated else it }
            updated
        } catch (e: Exception) {
            cached
        }
    }

    override fun dungeon(lotId: String) = mock.dungeon(lotId)

    private fun parseLot(o: JSONObject): ParkingLot {
        val d = o.getJSONObject("difficulty")
        val mf = d.getJSONArray("missingFactors")
        return ParkingLot(
            id = o.getString("id"), name = o.getString("name"),
            lat = o.getDouble("lat"), lng = o.getDouble("lng"),
            isPartner = o.getBoolean("partner"), synthetic = o.getBoolean("synthetic"),
            source = LotSource.SERVER, distanceM = o.getDouble("distanceM").toFloat(),
            serverDifficulty = ServerDifficulty(
                score = d.getDouble("score").toFloat(),
                vehicleAdjusted = d.getString("basis") == "VEHICLE_ADJUSTED",
                ruleVersion = d.getString("ruleVersion"),
                missingFactors = (0 until mf.length()).mapNotNull { i -> DifficultyFactor.entries.find { it.name == mf.getString(i) } },
                sampleCount = d.getInt("sampleCount"),
            ),
        )
    }

    /** Server values win; mock-only fields fill in when the ids match. */
    private fun mergeMock(s: ParkingLot): ParkingLot {
        val m = mock.lot(s.id) ?: return s
        return m.copy(
            name = s.name, lat = s.lat, lng = s.lng, isPartner = s.isPartner, synthetic = s.synthetic,
            source = LotSource.SERVER, distanceM = s.distanceM, serverDifficulty = s.serverDifficulty,
        )
    }

    private companion object { const val MAX_PAGES = 3 }
}
