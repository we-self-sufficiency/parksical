package com.parksical.data.remote

import com.parksical.data.LotsStatus
import com.parksical.data.ParkingRepository
import com.parksical.domain.model.DifficultyFactor
import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.LotSource
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ServerDifficulty
import com.parksical.domain.model.ServerFloor
import com.parksical.domain.model.ServerStructure
import com.parksical.domain.model.ServerZone
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject

/** Server fee schedule -> price for 30 minutes (capped by the daily max); null when unknown. */
fun fee30Min(baseMinutes: Int, baseAmount: Int, additionalMinutes: Int, additionalAmount: Int, dailyMax: Int?): Int {
    val extra = if (baseMinutes >= 30 || additionalMinutes <= 0) 0 else (30 - baseMinutes + additionalMinutes - 1) / additionalMinutes * additionalAmount
    return (baseAmount + extra).let { if (dailyMax != null) minOf(it, dailyMax) else it }
}

/** [days] = (day 1..7, openMinute, closeMinute). Same hours all week -> "HH:MM–HH:MM", else "요일별 상이". */
fun hoursText(days: List<Triple<Int, Int, Int>>?): String? {
    if (days.isNullOrEmpty()) return null
    val first = days.first()
    if (days.map { it.first }.toSet().size != 7 || days.any { it.second != first.second || it.third != first.third }) return "요일별 상이"
    fun hm(m: Int) = "%02d:%02d".format(m / 60, m % 60)
    return hm(first.second) + "–" + hm(first.third)
}

fun factorOf(name: String): DifficultyFactor? = when (name) {
    "structure" -> DifficultyFactor.STRUCTURE
    "review" -> DifficultyFactor.REVIEW
    "driving" -> DifficultyFactor.DRIVING_STATS
    "age" -> DifficultyFactor.BUILDING_AGE
    else -> null
}

private class NoAuth : Exception()

class ServerParkingRepository(
    private val api: ApiClient,
    private val auth: AuthRepository,
) : ParkingRepository {
    // shortcut: destination is fixed until a destination source exists
    override val destinationName = "테헤란로 거래처 미팅"
    override val destinationLat = 37.5006
    override val destinationLng = 127.0364

    private val _lots = MutableStateFlow<List<ParkingLot>>(emptyList())
    override val lots: StateFlow<List<ParkingLot>> = _lots
    private val _status = MutableStateFlow<LotsStatus>(LotsStatus.Loading)
    override val status: StateFlow<LotsStatus> = _status

    /** GET with bearer; one retry after a 401 with a fresh access token. */
    private suspend fun get(path: String, query: Map<String, String>): JSONObject {
        var token = auth.accessToken() ?: throw NoAuth()
        try {
            return api.request("GET", path, query = query, bearer = token).body!!
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            auth.invalidate()
            token = auth.accessToken() ?: throw NoAuth()
            return api.request("GET", path, query = query, bearer = token).body!!
        }
    }

    private fun vehicleQuery(d: VehicleDimensions?, q: MutableMap<String, String>) {
        d ?: return
        q["vehicleLengthMm"] = d.lengthMm.toString(); q["vehicleWidthMm"] = d.widthMm.toString(); q["vehicleStatus"] = "SUPPORTED"
    }

    override suspend fun refresh(dimensions: VehicleDimensions?) {
        _status.value = LotsStatus.Loading
        try {
            val out = mutableListOf<ParkingLot>()
            var cursor: String? = null
            var restarted = false
            var page = 1
            while (page <= MAX_PAGES) {
                val q = linkedMapOf(
                    "latitude" to destinationLat.toString(), "longitude" to destinationLng.toString(),
                    "radiusM" to "1000", "limit" to "50", "sort" to "DISTANCE",
                )
                vehicleQuery(dimensions, q)
                cursor?.let { q["cursor"] = it }
                val body = try {
                    get("/lots", q)
                } catch (e: ApiException) {
                    // result set changed under the cursor: start over once
                    if (cursor != null && e.status == 409 && e.code == "SEARCH_CHANGED" && !restarted) {
                        restarted = true; cursor = null; page = 1; out.clear(); continue
                    }
                    throw e
                }
                val items = body.getJSONArray("items")
                for (i in 0 until items.length()) out += parseLot(items.getJSONObject(i))
                cursor = if (body.isNull("nextCursor")) null else body.optString("nextCursor").takeIf { it.isNotEmpty() }
                if (cursor == null) break
                page++
            }
            _lots.value = out
            _status.value = LotsStatus.Server
        } catch (e: Exception) {
            _lots.value = emptyList()
            _status.value = LotsStatus.Error(if (e is NoAuth) auth.lastError?.let(::fallbackReason)?.takeIf { it == "서버 연결 안 됨" } ?: "서버 인증 안 됨" else fallbackReason(e))
        }
    }

    override fun lot(id: String) = _lots.value.find { it.id == id }

    override suspend fun loadDetail(id: String, dimensions: VehicleDimensions?): ParkingLot? {
        val cached = lot(id)
        if (cached?.source != LotSource.SERVER) return cached
        return try {
            val q = linkedMapOf<String, String>()
            vehicleQuery(dimensions, q)
            val d = get("/lots/$id", q)
            val snap = d.getJSONObject("snapshot")
            val nav = d.optJSONObject("navigation")
            val usable = nav?.optBoolean("usable", false) == true
            val zones = snap.optJSONArray("zones") ?: JSONArray()
            val floors = snap.optJSONArray("floors") ?: JSONArray()
            val updated = cached.copy(
                serverDifficulty = parseDifficulty(d.getJSONObject("difficulty")),
                fee30MinWon = parseFee(snap.optJSONObject("fees")),
                hours = parseHours(snap.optJSONArray("operatingHours")),
                serverStructure = ServerStructure(d.getInt("version").toString(), (0 until floors.length()).map { i ->
                    val f = floors.getJSONObject(i)
                    val fid = f.getString("id")
                    ServerFloor(fid, f.getString("label"), if (f.isNull("level")) null else f.getInt("level"),
                        (0 until zones.length()).map(zones::getJSONObject).filter { it.getString("floorId") == fid }
                            .map { ServerZone(it.getString("id"), it.getString("label")) })
                }),
                navigationLat = if (usable) nav?.getDouble("latitude") else null,
                navigationLng = if (usable) nav?.getDouble("longitude") else null,
            )
            _lots.value = _lots.value.map { if (it.id == id) updated else it }
            updated
        } catch (e: Exception) {
            cached
        }
    }

    // no server dungeon source yet: MAX shows its unavailable state
    override fun dungeon(lotId: String): Dungeon? = null

    private fun parseFee(f: JSONObject?): Int? = f?.let {
        fee30Min(
            it.getInt("baseMinutes"), it.getInt("baseAmount"), it.getInt("additionalMinutes"), it.getInt("additionalAmount"),
            if (it.isNull("dailyMaxAmount")) null else it.getInt("dailyMaxAmount"),
        )
    }

    private fun parseHours(a: JSONArray?): String? = hoursText(a?.let {
        (0 until it.length()).map { i -> it.getJSONObject(i).let { o -> Triple(o.getInt("day"), o.getInt("openMinute"), o.getInt("closeMinute")) } }
    })

    /** Works for list items and detail (detail also carries `factors`). */
    private fun parseDifficulty(d: JSONObject): ServerDifficulty {
        val ex = d.optJSONObject("coverage")?.optJSONArray("excludedFactors") ?: JSONArray()
        val fa = d.optJSONArray("factors") ?: JSONArray()
        return ServerDifficulty(
            score = if (d.isNull("score")) null else d.getDouble("score").toFloat(),
            vehicleAdjusted = d.optJSONObject("vehicle")?.optString("basis") == "PROVIDED_DIMENSIONS",
            ruleVersion = d.getString("ruleVersion"),
            missingFactors = (0 until ex.length()).mapNotNull { factorOf(ex.getString(it)) },
            sampleCount = d.optJSONObject("reviewAggregation")?.takeIf { !it.isNull("sampleCount") }?.getInt("sampleCount") ?: 0,
            factorScores = (0 until fa.length()).mapNotNull { i ->
                val f = fa.getJSONObject(i)
                factorOf(f.getString("name"))?.let { k ->
                    k to if (f.optString("status") == "INCLUDED" && !f.isNull("score")) f.getDouble("score").toFloat() else null
                }
            }.toMap(),
        )
    }

    private fun parseLot(o: JSONObject): ParkingLot {
        val nav = o.optJSONObject("navigation")
        val usable = nav?.optBoolean("usable", false) == true
        val tags = o.optJSONArray("tags")
        return ParkingLot(
            id = o.getString("id"), name = o.getString("name"), subtitle = o.optString("address").takeIf { it.isNotEmpty() },
            lat = o.getDouble("latitude"), lng = o.getDouble("longitude"),
            fee30MinWon = parseFee(o.optJSONObject("fees")), hours = parseHours(o.optJSONArray("operatingHours")),
            builtYear = if (o.isNull("builtYear")) null else o.optInt("builtYear"),
            isPublic = when (o.optString("ownership")) { "PUBLIC" -> true; "PRIVATE" -> false; else -> null },
            isPartner = o.getBoolean("partnered"),
            tags = tags?.let { t -> (0 until t.length()).map(t::getString) }.orEmpty(),
            synthetic = o.optString("source") == "SYNTHETIC",
            source = LotSource.SERVER, distanceM = o.getDouble("distanceM").toFloat(), challengeOpen = false,
            serverDifficulty = parseDifficulty(o.getJSONObject("difficulty")),
            navigationLat = if (usable) nav?.getDouble("latitude") else null,
            navigationLng = if (usable) nav?.getDouble("longitude") else null,
        )
    }

    private companion object { const val MAX_PAGES = 3 }
}
