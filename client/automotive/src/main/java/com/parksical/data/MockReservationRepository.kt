package com.parksical.data

import com.parksical.data.remote.ConfirmedReservation
import com.parksical.data.remote.ReservationPolicy
import com.parksical.data.remote.ReservationQuote
import com.parksical.data.remote.ReservationRepository
import com.parksical.data.remote.ReservationSlot
import com.parksical.domain.model.RunMode
import com.parksical.vehicle.VehicleDimensions
import java.time.Instant
import java.util.UUID
import kotlin.math.roundToInt

/** Offline reservations for mock mode: nothing leaves the device and no payment happens. */
class MockReservationRepository(
    private val parking: ParkingRepository,
    private val now: () -> Instant = Instant::now,
) : ReservationRepository {

    override suspend fun policy(lotId: String): ReservationPolicy {
        val d = parking.dungeon(lotId)
        return ReservationPolicy(
            safetyRules = listOf("저속(10km/h 이하)을 넘으면 미션이 자동 중단됩니다", "주행 중에는 화면이 최소 표시로 바뀝니다", "시설 파손 책임 규정을 확인했습니다"),
            safetyRulesVersion = "mock",
            allowedModes = setOf("CHALLENGE", "PRACTICE"),
            currentlyAvailable = d != null,
            challengeMultiplier = d?.challengeMultiplier?.toString()?.toDouble() ?: 1.0, // via String: Float 1.2f.toDouble() is 1.2000000476837158
            practiceMultiplier = d?.practiceMultiplier?.toString()?.toDouble() ?: 1.0,
        )
    }

    /** shortcut: [date] is ignored, always the next 7 half-hours from now (the server grid is KST-aligned, +9h is a multiple of 30 min). */
    override suspend fun slots(lotId: String, date: String, mode: RunMode, dims: VehicleDimensions): List<ReservationSlot> {
        val first = (now().epochSecond / SLOT_SEC + 1) * SLOT_SEC
        return (0 until 7).map {
            ReservationSlot(Instant.ofEpochSecond(first + it * SLOT_SEC), Instant.ofEpochSecond(first + (it + 1) * SLOT_SEC), 3, true)
        }
    }

    override suspend fun quote(lotId: String, mode: RunMode, startsAt: Instant, minutes: Int, dims: VehicleDimensions): ReservationQuote {
        val fee = parking.lot(lotId)?.fee30MinWon ?: 0
        val d = parking.dungeon(lotId)
        val mult = (if (mode == RunMode.CHALLENGE) d?.challengeMultiplier else d?.practiceMultiplier)?.toString()?.toDouble() ?: 1.0
        val slots = minutes / 30
        return ReservationQuote("mock-quote", (fee * mult * slots).roundToInt(), mult, fee * slots)
    }

    override suspend fun reserve(quote: ReservationQuote, safetyRulesVersion: String, agreedAt: Instant) =
        ConfirmedReservation("mock-" + UUID.randomUUID(), quote.amountKrw)

    private companion object { const val SLOT_SEC = 30 * 60L }
}

/** Picks the real or mock reservations by the current [DataMode] at call time. */
class ModeReservationRepository(
    private val mode: () -> DataMode,
    private val server: ReservationRepository,
    private val mock: ReservationRepository,
) : ReservationRepository {
    private val r get() = if (mode() is DataMode.Mock) mock else server
    override suspend fun policy(lotId: String) = r.policy(lotId)
    override suspend fun slots(lotId: String, date: String, mode: RunMode, dims: VehicleDimensions) = r.slots(lotId, date, mode, dims)
    override suspend fun quote(lotId: String, mode: RunMode, startsAt: Instant, minutes: Int, dims: VehicleDimensions) = r.quote(lotId, mode, startsAt, minutes, dims)
    override suspend fun reserve(quote: ReservationQuote, safetyRulesVersion: String, agreedAt: Instant) = r.reserve(quote, safetyRulesVersion, agreedAt)
}
