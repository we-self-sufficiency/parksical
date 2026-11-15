package com.parksical.data.remote

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.MissionType
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.Stage
import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.roundToInt

/** org.json -> plain Map/List so parsing and result building stay unit-testable (android.jar org.json is stubbed in JVM tests). */
fun JSONObject.toMap(): Map<String, Any?> = keys().asSequence().associateWith { unwrap(get(it)) }

private fun unwrap(v: Any?): Any? = when (v) {
    JSONObject.NULL -> null
    is JSONObject -> v.toMap()
    is JSONArray -> (0 until v.length()).map { unwrap(v.get(it)) }
    else -> v
}

fun toJson(v: Any?): Any = when (v) {
    null -> JSONObject.NULL
    is Map<*, *> -> JSONObject().also { o -> v.forEach { (k, x) -> o.put(k as String, toJson(x)) } }
    is List<*> -> JSONArray().also { a -> v.forEach { a.put(toJson(it)) } }
    else -> v
}

// Physical order: ramp down, drive the zone, park.
private val ORDER = listOf(MissionType.NO_STOP_RAMP, MissionType.SMOOTH_STEERING, MissionType.ONE_SHOT_REVERSE)

// shortcut: progress distances are client-side (the server has no stage lengths); the last stage ends on P, so reverse needs none.
private fun lengthOf(m: MissionType) = when (m) { MissionType.NO_STOP_RAMP -> 60f; MissionType.SMOOTH_STEERING -> 50f; MissionType.ONE_SHOT_REVERSE -> 0f }

/** `GET /missions` body -> [Dungeon]; null when no enabled stage is usable. Unknown mission codes are ignored. */
@Suppress("UNCHECKED_CAST")
fun dungeonFromCatalog(lot: ParkingLot, root: Map<String, Any?>): Dungeon? {
    val rules = root["rules"] as? Map<String, Any?> ?: return null
    val items = root["items"] as? List<Map<String, Any?>> ?: return null
    val byMission = items.filter { it["developmentStatus"] != "DISABLED" && it["stage"] != null }
        .mapNotNull { item ->
            val stage = item["stage"] as Map<String, Any?>
            val mission = ORDER.firstOrNull { it.name == stage["missionCode"] } ?: return@mapNotNull null
            mission to stage
        }.toMap()
    val stages = ORDER.mapNotNull { m -> byMission[m]?.let { m to it } }.mapIndexed { i, (m, st) ->
        Stage(
            index = i + 1, label = "STAGE ${i + 1}", floor = st["floorId"] as String, mission = m, lengthM = lengthOf(m),
            stageId = st["stageId"] as String, requiredQuality = (st["requiredQuality"] as List<String>),
        )
    }
    if (stages.isEmpty()) return null
    return Dungeon(
        lotId = lot.id, name = "${lot.name} 던전",
        stars = lot.serverDifficulty?.score?.roundToInt()?.coerceIn(1, 5) ?: 3,
        timeLimitSec = ((rules["maxElapsedMs"] as Number).toLong() / 1000).toInt(),
        stages = stages, challengeMultiplier = 1f, practiceMultiplier = 1f, openSlots = emptyList(),
        ruleVersion = root["ruleVersion"] as String, structureVersion = (root["structureVersion"] as Number).toInt(),
        maxGapMs = (rules["maxGapMs"] as Number).toLong(),
    )
}
