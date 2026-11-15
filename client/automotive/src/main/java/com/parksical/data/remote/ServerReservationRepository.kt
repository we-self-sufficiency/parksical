package com.parksical.data.remote

import com.parksical.domain.model.RunMode
import com.parksical.vehicle.VehicleDimensions
import java.time.Instant

/** Server numbers only; nothing here is priced or defaulted on the client. */
data class ReservationPolicy(
    val safetyRules: List<String>, val safetyRulesVersion: String, val allowedModes: Set<String>,
    val currentlyAvailable: Boolean, val challengeMultiplier: Double, val practiceMultiplier: Double,
)

data class ReservationSlot(val startsAt: Instant, val endsAt: Instant, val remaining: Int, val available: Boolean)

data class ReservationQuote(val quoteId: String, val amountKrw: Int, val multiplier: Double, val generalAmountKrw: Int)

/** A paid (sandbox) reservation: id + the server's fixed amount. */
data class ConfirmedReservation(val id: String, val amountKrw: Int)

@Suppress("UNCHECKED_CAST")
fun parsePolicy(root: Map<String, Any?>): ReservationPolicy {
    val s = root["snapshot"] as Map<String, Any?>
    return ReservationPolicy(
        safetyRules = (s["safetyRules"] as List<String>), safetyRulesVersion = s["safetyRulesVersion"] as String,
        allowedModes = (s["allowedModes"] as List<String>).toSet(),
        currentlyAvailable = root["currentlyAvailable"] == true,
        challengeMultiplier = (s["challengeMultiplierBps"] as Number).toDouble() / 10_000,
        practiceMultiplier = (s["practiceMultiplierBps"] as Number).toDouble() / 10_000,
    )
}

@Suppress("UNCHECKED_CAST")
fun parseSlots(root: Map<String, Any?>): List<ReservationSlot> = (root["items"] as List<Map<String, Any?>>).map {
    ReservationSlot(
        Instant.parse(it["startsAt"] as String), Instant.parse(it["endsAt"] as String),
        (it["remainingCapacity"] as Number).toInt(), it["available"] == true,
    )
}

@Suppress("UNCHECKED_CAST")
fun parseQuote(root: Map<String, Any?>): ReservationQuote {
    val d = root["details"] as Map<String, Any?>
    return ReservationQuote(
        root["quoteId"] as String, (d["amountKrw"] as Number).toInt(),
        (d["multiplierBps"] as Number).toDouble() / 10_000, (d["generalAmountKrw"] as Number).toInt(),
    )
}

/** Slot starts are on the :00/:30 grid; Instant.toString() prints UTC `Z` with zero seconds. No price fields by design. */
fun quoteBody(lotId: String, mode: RunMode, startsAt: Instant, minutes: Int, dims: VehicleDimensions): Map<String, Any?> = mapOf(
    "lotId" to lotId, "mode" to mode.name, "startsAt" to startsAt.toString(), "durationMinutes" to minutes,
    "lengthMm" to dims.lengthMm, "widthMm" to dims.widthMm,
)

fun holdBody(quoteId: String, safetyRulesVersion: String, agreedAt: Instant): Map<String, Any?> =
    mapOf("quoteId" to quoteId, "safetyRulesVersion" to safetyRulesVersion, "safetyAgreedAt" to agreedAt.truncatedTo(java.time.temporal.ChronoUnit.MILLIS).toString())

/** What the MAX reservation dialog needs; server and mock (offline) implementations. */
interface ReservationRepository {
    suspend fun policy(lotId: String): ReservationPolicy
    suspend fun slots(lotId: String, date: String, mode: RunMode, dims: VehicleDimensions): List<ReservationSlot>
    suspend fun quote(lotId: String, mode: RunMode, startsAt: Instant, minutes: Int, dims: VehicleDimensions): ReservationQuote
    suspend fun reserve(quote: ReservationQuote, safetyRulesVersion: String, agreedAt: Instant): ConfirmedReservation
}

/** S-14 synthetic reservations (docs/reservations.md). Throws [ApiException]; callers show the reason. */
class ServerReservationRepository(private val api: ApiClient, private val auth: AuthRepository) : ReservationRepository {

    override suspend fun policy(lotId: String) = parsePolicy(call("GET", "/lots/$lotId/reservation-policy"))

    override suspend fun slots(lotId: String, date: String, mode: RunMode, dims: VehicleDimensions) = parseSlots(call(
        "GET", "/lots/$lotId/reservation-slots",
        query = mapOf("date" to date, "mode" to mode.name, "lengthMm" to "${dims.lengthMm}", "widthMm" to "${dims.widthMm}"),
    ))

    override suspend fun quote(lotId: String, mode: RunMode, startsAt: Instant, minutes: Int, dims: VehicleDimensions) = parseQuote(call(
        "POST", "/reservation-quotes", body = quoteBody(lotId, mode, startsAt, minutes, dims), key = "quote-${java.util.UUID.randomUUID()}",
    ))

    /**
     * HELD, then payment -> SANDBOX_CONFIRMED. S-16: bind an order to the hold and run a sandbox attempt; the server
     * confirms the reservation only after verifying the provider. Falls back to the S-14 sandbox command when the
     * payments feature is off. Keys derive from ids so a retry replays instead of duplicating.
     */
    override suspend fun reserve(quote: ReservationQuote, safetyRulesVersion: String, agreedAt: Instant): ConfirmedReservation {
        val held = call("POST", "/reservations", body = holdBody(quote.quoteId, safetyRulesVersion, agreedAt), key = "hold-${quote.quoteId}")
        val id = held["id"] as String
        val order = try {
            call("POST", "/payments/reservations", body = mapOf("reservationId" to id), key = "order-$id")
        } catch (e: ApiException) {
            if (e.status != 403 || e.code != "PAYMENTS_POLICY_DISABLED") throw e
            null
        }
        if (order == null) {
            val receipt = call("POST", "/reservations/$id/sandbox-events", body = mapOf("kind" to "PAYMENT_SUCCEEDED"), key = "pay-$id")
            @Suppress("UNCHECKED_CAST")
            check((receipt["reservation"] as Map<String, Any?>)["state"] == "SANDBOX_CONFIRMED") { "unexpected state" }
            return ConfirmedReservation(id, quote.amountKrw)
        }
        val orderId = order["id"] as String
        var paid = call("POST", "/payments/$orderId/attempts", body = mapOf("sandboxOutcome" to "SUCCEEDED"), key = "attempt-$orderId")
        if (paid["state"] == "PENDING") paid = call("GET", "/payments/$orderId")
        if (paid["state"] != "SUCCEEDED") throw ApiException(402, "PAYMENT_NOT_APPROVED")
        // the attempt response is a snapshot; read the reservation's current state
        if (call("GET", "/reservations/$id")["state"] != "SANDBOX_CONFIRMED") throw ApiException(402, "PAYMENT_NOT_APPROVED")
        return ConfirmedReservation(id, (paid["amountKrw"] as? Number)?.toInt() ?: quote.amountKrw)
    }

    private suspend fun call(
        method: String, path: String, query: Map<String, String> = emptyMap(), body: Map<String, Any?>? = null, key: String? = null,
    ): Map<String, Any?> {
        val json = body?.let { toJson(it) as org.json.JSONObject }
        var token = auth.accessToken() ?: throw ApiException(401)
        val res = try {
            api.request(method, path, query, json, token, key)
        } catch (e: ApiException) {
            if (e.status != 401) throw e
            auth.invalidate()
            token = auth.accessToken() ?: throw ApiException(401)
            api.request(method, path, query, json, token, key)
        }
        return res.body?.toMap() ?: throw ApiException(res.status)
    }
}

/** Short Korean reason for a failed reservation call. */
fun reservationReason(e: Throwable): String = when {
    e !is ApiException -> "서버 오류"
    e.status == 0 -> "서버 연결 안 됨"
    e.status == 403 && e.code == "SYNTHETIC_PASS_REQUIRED" -> "P지컬 MAX 이용권이 필요해요"
    e.status == 403 -> "예약 기능이 꺼져 있어요"
    e.status == 404 -> "이 주차장은 예약을 받지 않아요"
    // server codes are prefixed, e.g. RESERVATION_USER_OVERLAP
    e.status == 409 -> when (e.code?.removePrefix("RESERVATION_")) {
        "SLOT_FULL" -> "방금 다른 예약으로 찼어요"
        "QUOTE_EXPIRED", "QUOTE_ALREADY_USED" -> "견적 시간이 지났어요"
        "QUOTE_POLICY_CHANGED", "STRUCTURE_CHANGED" -> "예약 정책이 바뀌었어요"
        "USER_OVERLAP" -> "이미 예약한 시간과 겹쳐요"
        else -> "예약 상태가 바뀌었어요"
    }
    e.status == 402 -> "결제가 승인되지 않았어요"
    e.status == 429 -> "잠시 후 다시 시도해 주세요"
    else -> "서버 오류"
}
