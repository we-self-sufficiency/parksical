package com.parksical.data.remote

import com.parksical.domain.model.RunMode
import com.parksical.vehicle.VehicleDimensions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class ReservationParsingTest {
    // Copies of parksical-server docs/examples (S-14).
    private fun ex(n: String) = parseJson(javaClass.getResource("/reservation/$n.json")!!.readText())

    @Test fun policy() {
        val p = parsePolicy(ex("reservation-policy"))
        assertEquals(3, p.safetyRules.size)
        assertEquals("synthetic-safety-v1", p.safetyRulesVersion)
        assertEquals(setOf("CHALLENGE", "PRACTICE"), p.allowedModes)
        assertTrue(p.currentlyAvailable)
        assertEquals(1.75, p.challengeMultiplier, 0.0)
        assertEquals(1.25, p.practiceMultiplier, 0.0)
    }

    @Test fun slots() {
        val s = parseSlots(ex("reservation-slots"))
        assertEquals(48, s.size)
        assertEquals(Instant.parse("2026-11-15T15:00:00Z"), s[0].startsAt)
        assertEquals(1, s[0].remaining)
        assertTrue(s[0].available)
    }

    @Test fun quote() {
        val q = parseQuote(ex("reservation-challenge-quote"))
        assertEquals(1750, q.amountKrw)
        assertEquals(1000, q.generalAmountKrw)
        assertEquals(1.75, q.multiplier, 0.0)
        assertEquals("d67203ed-f653-4455-a910-1a9a124a18d0", q.quoteId)
    }

    @Test fun requestBodiesHaveNoPriceAndUtcGrid() {
        val b = quoteBody("lot", RunMode.PRACTICE, Instant.parse("2026-11-16T01:30:00.000Z"), 60, VehicleDimensions(4800, 1850))
        assertEquals(setOf("lotId", "mode", "startsAt", "durationMinutes", "lengthMm", "widthMm"), b.keys)
        assertEquals("2026-11-16T01:30:00Z", b["startsAt"])
        assertEquals(60, b["durationMinutes"])
        val h = holdBody("q", "v1", Instant.parse("2026-11-15T08:35:58.923456Z"))
        assertEquals(setOf("quoteId", "safetyRulesVersion", "safetyAgreedAt"), h.keys)
        assertEquals("2026-11-15T08:35:58.923Z", h["safetyAgreedAt"])
        assertFalse(b.keys.any { it.contains("amount", true) || it.contains("price", true) })
    }

    @Test fun reasons() {
        assertEquals("방금 다른 예약으로 찼어요", reservationReason(ApiException(409, "RESERVATION_SLOT_FULL")))
        assertEquals("이미 예약한 시간과 겹쳐요", reservationReason(ApiException(409, "RESERVATION_USER_OVERLAP")))
        assertEquals("서버 연결 안 됨", reservationReason(ApiException(0)))
        assertEquals("예약 기능이 꺼져 있어요", reservationReason(ApiException(403, "RESERVATIONS_POLICY_DISABLED")))
    }
}
