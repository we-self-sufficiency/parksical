package com.parksical.data

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.FloorLayout
import com.parksical.domain.model.LotLayout
import com.parksical.domain.model.LotStructure
import com.parksical.domain.model.MissionType
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.RampType
import com.parksical.domain.model.Stage
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleDimensions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Synthetic demo data from docs/mockups (01 map home, 02 detail, 05 stage map). Destination: 테헤란로 거래처.
 * Used directly when the server is unavailable and as the source of fields the server contract lacks.
 */
class MockParkingRepository : ParkingRepository {
    override val destinationName = "테헤란로 거래처 미팅"
    override val destinationLat = 37.5006
    override val destinationLng = 127.0364

    private val seed = listOf(
        ParkingLot(
            id = "saesol", name = "새솔 공영주차장", subtitle = "공영 · 지상 평면",
            lat = 37.5021, lng = 127.0339, walkMinutes = 4, fee30MinWon = 1500, hours = "00:00–24:00",
            builtYear = 2015, isPublic = true, isPartner = true, prepayDiscountPercent = 10,
            tags = listOf("평면", "면 폭 넓음"),
            structure = LotStructure(6.5f, RampType.FLAT, 0f, 0.1f, 2.6f),
            reviewDifficulty = 1.4f, reviewCount = 312, avgGearShifts = 1.6f, avgParkSeconds = 45,
        ),
        ParkingLot(
            id = "nuri", name = "누리타워 지하주차장", subtitle = "민영 · 지하 1~3층",
            lat = 37.5012, lng = 127.0381, walkMinutes = 2, fee30MinWon = 2000, hours = "06:00–24:00",
            builtYear = 2008, isPublic = false, isPartner = false, prepayDiscountPercent = 0,
            tags = listOf("직선 경사로", "기둥 많음"),
            structure = LotStructure(4.0f, RampType.STRAIGHT, 0f, 0.6f, 2.4f),
            reviewDifficulty = 3.1f, reviewCount = 96, avgGearShifts = 3.0f, avgParkSeconds = 80,
        ),
        ParkingLot(
            id = "daon", name = "다온빌딩 부설주차장", subtitle = "목적지 건물 내 · 지하 1~4층",
            lat = 37.5006, lng = 127.0364, walkMinutes = 0, fee30MinWon = 2500, hours = "07:00–22:00",
            builtYear = 1998, isPublic = false, isPartner = true, prepayDiscountPercent = 0,
            tags = listOf("나선 경사로 2바퀴", "진입로 폭 좁음"),
            structure = LotStructure(3.0f, RampType.SPIRAL, 2f, 0.8f, 2.3f),
            reviewDifficulty = 4.3f, reviewCount = 128, avgGearShifts = 4.2f, avgParkSeconds = 140,
            layout = LotLayout(
                entranceToRampM = 25f,
                floors = listOf(
                    FloorLayout("B1", listOf("A", "B", "C", "D"), 80f),
                    FloorLayout("B2", listOf("A", "B", "C", "D"), 80f),
                    FloorLayout("B3", listOf("A", "B", "C"), 60f),
                    FloorLayout("B4", listOf("A", "B"), 40f),
                ),
            ),
            challengeOpen = true, challengeHours = "매주 토 22:30–02:00",
        ),
        ParkingLot(
            id = "hangyeol", name = "한결 기계식 주차타워", subtitle = "민영 · 기계식",
            lat = 37.4991, lng = 127.0398, walkMinutes = 6, fee30MinWon = 1800, hours = "08:00–21:00",
            builtYear = 2002, isPublic = false, isPartner = true, prepayDiscountPercent = 0,
            tags = listOf("기계식", "대형 SUV 불가"),
            structure = LotStructure(2.6f, RampType.MECHANICAL, 0f, 0f, 2.0f, maxSize = VehicleSize.LARGE_SEDAN),
            reviewDifficulty = 4.8f, reviewCount = 54, avgGearShifts = 5.1f, avgParkSeconds = 190,
            challengeOpen = true, challengeHours = "매주 일 21:00–24:00",
        ),
    )

    private val dungeons = mapOf(
        "daon" to Dungeon(
            lotId = "daon", name = "다온빌딩 던전", stars = 4, timeLimitSec = 60 * 60,
            stages = listOf(
                Stage(1, "STAGE 1", "B1→B2", MissionType.NO_STOP_RAMP, lengthM = 60f, stageId = "NO_STOP_RAMP:ramp-b1"),
                Stage(2, "STAGE 2", "B2", MissionType.SMOOTH_STEERING, lengthM = 50f, stageId = "SMOOTH_STEERING:basement-a"),
                Stage(3, "STAGE 3", "B3", MissionType.ONE_SHOT_REVERSE, lengthM = 0f, stageId = "ONE_SHOT_REVERSE:basement1-s03"),
            ),
            challengeMultiplier = 2.0f, practiceMultiplier = 1.2f,
            openSlots = listOf("22:30–23:00", "23:00–23:30", "23:30–24:00", "00:00–00:30", "00:30–01:00"),
        ),
    )

    private val _lots = MutableStateFlow(seed.map { it.copy(synthetic = true, challengeOpen = it.id in dungeons) })
    override val lots: StateFlow<List<ParkingLot>> = _lots
    override val status: StateFlow<LotsStatus> = MutableStateFlow(LotsStatus.Error("테스트용 데이터"))

    override suspend fun refresh(dimensions: VehicleDimensions?) {}
    override fun lot(id: String) = _lots.value.find { it.id == id }
    override suspend fun loadDetail(id: String, dimensions: VehicleDimensions?) = lot(id)
    override fun dungeon(lotId: String) = dungeons[lotId]
}
