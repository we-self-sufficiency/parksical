package com.parksical.data.remote

import com.parksical.domain.model.ParkingSpotEstimate
import com.parksical.domain.model.ServerFloor
import com.parksical.domain.model.ServerStructure
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RemoteLogicTest {
    private val st = ServerStructure("v3", listOf(ServerFloor("f-b2", "B2", listOf("z-A", "B"))))
    private fun spot(floor: String, zone: String) = ParkingSpotEstimate("l", floor, zone, 0.8f, 0)

    @Test fun confidence() {
        assertEquals("HIGH", confidenceOf(0.75f)); assertEquals("MEDIUM", confidenceOf(0.5f))
        assertEquals("LOW", confidenceOf(0.1f)); assertEquals("UNKNOWN", confidenceOf(0f))
    }

    @Test fun ids() {
        assertEquals(LocationIds("f-b2", "z-A", "v3"), locationIds(spot("B2", "A"), st))
        assertEquals(LocationIds("f-b2", "B", "v3"), locationIds(spot("B2", "B"), st))
        assertEquals(LocationIds("f-b2", null, "v3"), locationIds(spot("B2", "Q"), st))
        assertEquals(LocationIds(null, null, null), locationIds(spot("B9", "A"), st))
        assertEquals(LocationIds(null, null, null), locationIds(spot("B2", "A"), null))
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
