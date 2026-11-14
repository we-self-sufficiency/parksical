package com.parksical.data.remote

import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.domain.model.ServerFloor
import com.parksical.domain.model.DifficultyFactor
import com.parksical.domain.model.ServerStructure
import com.parksical.domain.model.ServerZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteLogicTest {
    private val st = ServerStructure("v3", listOf(ServerFloor("f-b2", "B2", -2, listOf(ServerZone("z-A", "A"), ServerZone("z-B", "지하 B")))))
    private fun spot(floor: String, zone: String) = ParkingSpotEstimate("l", floor, zone, 0.8f, 0)

    @Test fun confidence() {
        assertEquals("HIGH", confidenceOf(0.75f)); assertEquals("MEDIUM", confidenceOf(0.5f))
        assertEquals("LOW", confidenceOf(0.1f)); assertEquals("UNKNOWN", confidenceOf(0f))
    }

    @Test fun ids() {
        assertEquals(LocationIds("f-b2", "z-A", "v3"), locationIds(spot("B2", "A"), st))
        assertEquals(LocationIds("f-b2", "z-B", "v3"), locationIds(spot("B2", "B"), st))
        assertEquals(LocationIds("f-b2", null, "v3"), locationIds(spot("B2", "Q"), st))
        assertEquals(LocationIds(null, null, null), locationIds(spot("B9", "A"), st))
        assertEquals(LocationIds(null, null, null), locationIds(spot("B2", "A"), null))
    }

    @Test fun idsByLevel() {
        val st2 = ServerStructure("1", listOf(ServerFloor("g", "1F (가상)", 0, emptyList()), ServerFloor("b1", "B1 (가상)", -1, listOf(ServerZone("b1a", "지하 A")))))
        assertEquals(LocationIds("b1", "b1a", "1"), locationIds(spot("B1", "A"), st2))
        assertEquals(LocationIds("g", null, "1"), locationIds(spot("1F", "A"), st2))
        assertEquals(-2, levelOf("B2")); assertNull(levelOf("지하"))
    }

    @Test fun fee30() {
        assertEquals(1000, fee30Min(30, 1000, 10, 500, 15000))
        assertEquals(1500, fee30Min(10, 1000, 10, 250, null))
        assertEquals(1000, fee30Min(10, 800, 10, 500, 1000))
        assertEquals(1000, fee30Min(5, 800, 15, 100, null))
    }

    @Test fun hours() {
        fun week(o: Int, c: Int) = (1..7).map { Triple(it, o, c) }
        assertEquals("00:00–24:00", hoursText(week(0, 1440)))
        assertEquals("09:30–18:00", hoursText(week(570, 1080)))
        assertEquals("요일별 상이", hoursText(week(0, 1440).dropLast(1) + Triple(7, 0, 600)))
        assertEquals("요일별 상이", hoursText(week(0, 1440).dropLast(1)))
        assertNull(hoursText(emptyList())); assertNull(hoursText(null))
    }

    @Test fun factors() {
        assertEquals(DifficultyFactor.DRIVING_STATS, factorOf("driving")); assertEquals(DifficultyFactor.BUILDING_AGE, factorOf("age"))
        assertEquals(DifficultyFactor.STRUCTURE, factorOf("structure")); assertNull(factorOf("x"))
    }

    @Test fun rfc3339() = assertEquals("2024-01-01T00:00:00Z", rfc3339Utc(1704067200000L))

    @Test fun reasons() {
        assertEquals("서버에 주차장 API 없음", fallbackReason(ApiException(404)))
        assertEquals("서버 오류", fallbackReason(ApiException(503)))
        assertEquals("서버 연결 안 됨", fallbackReason(ApiException(0)))
        assertEquals("서버 연결 안 됨", fallbackReason(java.net.SocketTimeoutException()))
        assertNull(ApiException(500).code)
    }
}
