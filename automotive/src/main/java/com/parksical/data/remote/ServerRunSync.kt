package com.parksical.data.remote

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunOutcome
import com.parksical.domain.model.RunReason
import com.parksical.domain.model.RunRecord
import com.parksical.domain.model.StageOutcome
import com.parksical.vehicle.VehicleCapabilities
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID

/**
 * Result body for `POST /runs/{id}/result` (parksical-server docs/missions.md), or null when the server cannot
 * represent this run (e.g. aborted before any stage span existed except the explicit early cases).
 * Plain maps so it is testable without org.json; [toJson] converts at the network edge.
 */
fun buildResultBody(record: RunRecord): Map<String, Any?>? {
    val ran = record.stageResults.filter { it.outcome != StageOutcome.NOT_RUN }
    if (ran.any { it.report == null }) return null
    val early = ran.isEmpty() && (
        (record.outcome == RunOutcome.ABORTED && record.reason == RunReason.USER_CANCELLED) ||
            (record.outcome == RunOutcome.UNVERIFIABLE && record.reason == RunReason.SIGNAL_QUALITY)
        )
    if (record.outcome == RunOutcome.COMPLETED && ran.size != record.stageResults.size) return null
    if (record.outcome != RunOutcome.COMPLETED && ran.isEmpty() && !early) return null
    // Offsets and elapsed come from the monotonic clock; finishedAt is derived so the two always agree within the server's 5 s tolerance.
    val elapsed = ran.lastOrNull()?.report?.endOffsetMs ?: 0L
    return mapOf(
        "expectedVersion" to 1,
        "clientResultId" to "res-${record.clientRunId}",
        "source" to "SYNTHETIC",
        "outcome" to record.outcome.name,
        "reason" to record.reason.name,
        "finishedAt" to rfc3339Utc(record.startedAtEpochMs + elapsed),
        "elapsedMs" to elapsed,
        "stars" to record.totalStars,
        "stages" to ran.map { r ->
            val rep = r.report!!
            val m = rep.metrics
            mapOf(
                "stageId" to r.stageId,
                "startOffsetMs" to rep.startOffsetMs,
                "endOffsetMs" to rep.endOffsetMs,
                "outcome" to r.outcome.name,
                "reason" to r.reason.name,
                "stars" to r.stars,
                // shortcut: AAOS requires DO whenever moving; the app shows only the DO-compliant minimal HUD, so we report ALLOWED. Revisit when server decision D-04 lands.
                "uxState" to "ALLOWED",
                "segmentEntered" to rep.segmentEntered,
                "segmentExited" to rep.segmentExited,
                "parkingConfirmed" to rep.parkingConfirmed,
                "metrics" to buildMap {
                    put("movingDurationMs", m.movingDurationMs)
                    put("maxSpeedKph", m.maxSpeedKph)
                    put("dangerEventCount", m.dangerEventCount)
                    put("reverseSegmentCount", m.reverseSegmentCount)
                    put("stopCount", m.stopCount)
                    put("abruptSteeringCount", m.abruptSteeringCount)
                    if (m.gearTransitionCount != null) put("gearTransitionCount", m.gearTransitionCount)
                },
                "quality" to rep.quality.map { q ->
                    mapOf("signal" to q.signal, "status" to q.status, "validSampleCount" to q.validSampleCount, "maxGapMs" to q.maxGapMs, "coveredMs" to q.coveredMs)
                },
            )
        },
    )
}

/** Our capability flags -> server status; true = SUPPORTED, false = UNSUPPORTED, signals we do not probe = UNKNOWN. */
fun capabilitiesBody(c: VehicleCapabilities, checkedAt: String): Map<String, Any?> {
    fun cap(status: String) = mapOf("status" to status, "checkedAt" to checkedAt)
    fun of(b: Boolean) = cap(if (b) "SUPPORTED" else "UNSUPPORTED")
    return mapOf(
        "gear" to of(c.gear), "speed" to of(c.speed), "steeringAngle" to of(c.steering), "brake" to of(c.brake),
        "safetyWarnings" to of(c.airbag), "carProfile" to cap("UNKNOWN"), "navigation" to cap("UNKNOWN"),
    )
}

/**
 * Vehicle session + run create + result upload. Every call is best effort: failures return null and the
 * run is still judged and kept locally ("서버 미제출"). Never throws.
 */
class ServerRunSync(private val api: ApiClient, private val auth: AuthRepository) {
    private val mutex = Mutex()
    private var sessionId: String? = null
    private var seq = 0

    /** Server runId, or null on any failure. */
    suspend fun createRun(dungeon: Dungeon, mode: RunMode, clientRunId: String, startedAtEpochMs: Long, caps: VehicleCapabilities): String? = try {
        val sid = try { ensureSession(caps) } catch (e: ApiException) {
            // session gone or conflicting on the server: start a fresh one once
            if (e.status != 404 && e.status != 409) throw e
            mutex.withLock { sessionId = null }
            ensureSession(caps)
        }
        val body = mapOf(
            "contractVersion" to "1.0", "clientRunId" to clientRunId, "vehicleSessionId" to sid,
            "lotId" to dungeon.lotId, "structureVersion" to dungeon.structureVersion, "ruleVersion" to dungeon.ruleVersion,
            "source" to "SYNTHETIC", "mode" to mode.name, "startedAt" to rfc3339Utc(startedAtEpochMs),
            "stageIds" to dungeon.stages.map { it.stageId },
        )
        send("POST", "/runs", body, "create-$clientRunId").getString("runId")
    } catch (e: Exception) { null }

    /** Receipt outcome (e.g. "COMPLETED"), or null when not accepted. 4xx is final; network/5xx/429 are retried. */
    suspend fun submitResult(runId: String, record: RunRecord): String? = try {
        val body = buildResultBody(record) ?: return null
        send("POST", "/runs/$runId/result", body, "result-${record.clientRunId}").getString("outcome")
    } catch (e: Exception) { null }

    private suspend fun ensureSession(caps: VehicleCapabilities): String = mutex.withLock {
        val now = rfc3339Utc(System.currentTimeMillis())
        if (sessionId == null) {
            val installationId = auth.installationId() ?: throw ApiException(401)
            val created = send("POST", "/vehicle-sessions", mapOf(
                "contractVersion" to "1.0", "appVersion" to "0.1.0", "installationId" to installationId,
                "capabilities" to capabilitiesBody(caps, now), "reportedSource" to "SYNTHETIC",
            ), "session-${UUID.randomUUID()}")
            sessionId = created.getString("id"); seq = 0
        }
        val sid = sessionId!!
        // Report again before every run: the server wants checkedAt within 5 min of startedAt.
        val eventId = "cap-${UUID.randomUUID().toString().replace("-", "")}"
        send("POST", "/vehicle-sessions/$sid/events", mapOf(
            "contractVersion" to "1.0", "eventId" to eventId, "sequence" to ++seq, "occurredAt" to now,
            "type" to "CAPABILITIES_REPORTED", "payload" to capabilitiesBody(caps, now),
        ), eventId)
        sid
    }

    /** Bearer call with one retry after 401, and backoff on network/5xx/429 (honouring Retry-After). */
    private suspend fun send(method: String, path: String, body: Map<String, Any?>, key: String): JSONObject {
        var wait = 1_000L
        for (attempt in 1..MAX_TRIES) {
            try {
                return once(method, path, body, key)
            } catch (e: ApiException) {
                val transient = e.status == 0 || e.status >= 500 || e.status == 429
                if (!transient || attempt == MAX_TRIES) throw e
                delay((e.retryAfterSec?.times(1000L) ?: wait).coerceIn(wait, 300_000L))
                wait *= 2
            }
        }
        throw ApiException(0)
    }

    private suspend fun once(method: String, path: String, body: Map<String, Any?>, key: String): JSONObject {
        val json = toJson(body) as JSONObject
        var token = auth.accessToken() ?: throw ApiException(401)
        try {
            return api.request(method, path, body = json, bearer = token, idempotencyKey = key).body!!
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            auth.invalidate()
            token = auth.accessToken() ?: throw ApiException(401)
            return api.request(method, path, body = json, bearer = token, idempotencyKey = key).body!!
        }
    }

    private companion object { const val MAX_TRIES = 4 }
}
