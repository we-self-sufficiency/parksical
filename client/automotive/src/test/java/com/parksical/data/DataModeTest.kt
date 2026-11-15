package com.parksical.data

import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.RunMode
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.time.ZoneId

/** Server stand-in: each refresh ends with [next] (and [lotsOnSuccess] when it is Server). */
private class FakeServer(private val mock: MockParkingRepository) : ParkingRepository by mock {
    var next: LotsStatus = LotsStatus.Server
    val own = MutableStateFlow<List<ParkingLot>>(emptyList())
    override val lots: StateFlow<List<ParkingLot>> = own
    override val status = MutableStateFlow<LotsStatus>(LotsStatus.Loading)
    override suspend fun refresh(dimensions: VehicleDimensions?) { status.value = next }
    override fun dungeon(lotId: String) = null
}

class DataModeTest {
    private val mock = MockParkingRepository()
    private val server = FakeServer(mock)
    private var running = false
    private val repo = FallbackParkingRepository(server, mock, CoroutineScope(Dispatchers.Unconfined)) { running }

    private fun refresh() = runBlocking { repo.refresh(null) }

    @Test fun networkErrorGoesMock() {
        server.next = LotsStatus.Error("서버 연결 안 됨"); refresh()
        assertEquals(DataMode.Mock("서버 연결 안 됨"), repo.mode.value)
        assertEquals(4, repo.lots.value.size)
        assertNotNull(repo.dungeon("daon"))
        assertEquals(LotsStatus.Server, repo.status.value)
    }

    @Test fun authImpossibleGoesMock() {
        server.next = LotsStatus.Error("서버 인증 안 됨"); refresh()
        assertEquals(DataMode.Mock("서버 인증 안 됨"), repo.mode.value)
    }

    @Test fun emptyServerAnswerStaysServer() {
        server.next = LotsStatus.Server; refresh()
        assertEquals(DataMode.Server, repo.mode.value)
        assertTrue(repo.lots.value.isEmpty())
    }

    @Test fun otherServerErrorsStayServer() {
        server.next = LotsStatus.Error("서버 오류"); refresh()
        assertEquals(DataMode.Server, repo.mode.value)
        assertEquals(LotsStatus.Error("서버 오류"), repo.status.value)
        assertNull(repo.dungeon("daon"))
    }

    @Test fun serverSuccessReturnsFromMock() {
        server.next = LotsStatus.Error("서버 연결 안 됨"); refresh()
        server.next = LotsStatus.Server; refresh()
        assertEquals(DataMode.Server, repo.mode.value)
        assertTrue(repo.lots.value.isEmpty()) // never mixed with mock lots
    }

    @Test fun noSwitchWhileRunActive() {
        running = true
        server.next = LotsStatus.Error("서버 연결 안 됨"); refresh()
        assertEquals(DataMode.Server, repo.mode.value)
        running = false; refresh()
        assertTrue(repo.mode.value is DataMode.Mock)
        running = true
        server.next = LotsStatus.Server; refresh()
        assertTrue(repo.mode.value is DataMode.Mock)
    }

    @Test fun onlyDungeonLotIsBookable() {
        assertEquals(listOf("daon"), mock.lots.value.filter { it.challengeOpen }.map { it.id })
    }
}

class MockReservationTest {
    private val parking = MockParkingRepository()
    // 2026-11-15 10:10 KST
    private val at = Instant.parse("2026-11-15T01:10:00Z")
    private val repo = MockReservationRepository(parking) { at }
    private val dims = VehicleDimensions(4700, 1850)

    @Test fun sevenUpcomingHalfHourSlots() = runBlocking {
        val s = repo.slots("daon", "2026-11-15", RunMode.CHALLENGE, dims)
        assertEquals(7, s.size)
        val kst = ZoneId.of("Asia/Seoul")
        assertEquals("10:30", s.first().startsAt.atZone(kst).toLocalTime().toString())
        assertEquals("14:00", s.last().endsAt.atZone(kst).toLocalTime().toString())
        s.forEach { assertTrue(it.available && it.remaining == 3 && it.startsAt.isAfter(at) && it.endsAt == it.startsAt.plusSeconds(1800)) }
    }

    @Test fun quoteArithmetic() = runBlocking {
        val q = repo.quote("daon", RunMode.CHALLENGE, at, 60, dims) // 2500 x 2.0 x 2
        assertEquals(10_000, q.amountKrw); assertEquals(5_000, q.generalAmountKrw)
        assertEquals(3_000 * 3, repo.quote("daon", RunMode.PRACTICE, at, 90, dims).amountKrw) // 2500 x 1.2 x 3
    }

    @Test fun reserveReturnsMockId() = runBlocking {
        val q = repo.quote("daon", RunMode.CHALLENGE, at, 30, dims)
        val r = repo.reserve(q, "mock", at)
        assertTrue(r.id.startsWith("mock-")); assertEquals(q.amountKrw, r.amountKrw)
        val p = repo.policy("daon")
        assertEquals(3, p.safetyRules.size); assertEquals(setOf("CHALLENGE", "PRACTICE"), p.allowedModes)
        assertTrue(p.currentlyAvailable); assertFalse(repo.policy("nuri").currentlyAvailable)
    }
}
