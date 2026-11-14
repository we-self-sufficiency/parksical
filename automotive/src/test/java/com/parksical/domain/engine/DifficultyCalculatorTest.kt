package com.parksical.domain.engine

import com.parksical.data.MockParkingRepository
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleDimensions
import com.parksical.domain.model.DifficultyFactor
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.ServerDifficulty
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DifficultyCalculatorTest {
    private val calc = DefaultDifficultyCalculator()
    private val repo = MockParkingRepository()
    private fun stars(id: String, size: VehicleSize) = calc.calculate(repo.lot(id)!!, size).forMyCar

    @Test fun mockLotsMatchMockup() {
        assertEquals(1.5f, stars("saesol", VehicleSize.MIDSIZE), 0f)
        assertEquals(3.0f, stars("nuri", VehicleSize.MIDSIZE), 0f)
        assertEquals(4.5f, stars("daon", VehicleSize.LARGE_SEDAN), 0f)
        assertEquals(3.5f, stars("daon", VehicleSize.COMPACT), 0f)
        assertEquals(5.0f, stars("hangyeol", VehicleSize.LARGE_SEDAN), 0f)
    }

    @Test fun suvOverMaxSizeIsFive() = assertEquals(5.0f, stars("hangyeol", VehicleSize.SUV), 0f)

    @Test fun daonFactorsCloseToMockup() {
        val b = calc.calculate(repo.lot("daon")!!, VehicleSize.LARGE_SEDAN)
        assertEquals(4.8f, b.structure!!, 0.6f)
        assertEquals(4.3f, b.review!!, 0.01f)
        assertEquals(4.5f, b.driving!!, 0.6f)
        assertEquals(4.0f, b.age!!, 0.6f)
    }

    @Test fun sizeOfDimensions() {
        assertEquals(VehicleSize.COMPACT, calc.sizeOf(VehicleDimensions(3600, 1600)))
        assertEquals(VehicleSize.MIDSIZE, calc.sizeOf(VehicleDimensions(4600, 1830)))
        assertEquals(VehicleSize.LARGE_SEDAN, calc.sizeOf(VehicleDimensions(5000, 1880)))
        assertEquals(VehicleSize.SUV, calc.sizeOf(VehicleDimensions(5200, 1990)))
    }

    private val bare = ParkingLot(id = "x", name = "x", lat = 0.0, lng = 0.0, isPartner = false)

    @Test fun serverInsufficient() {
        val sd = ServerDifficulty(null, false, "v1", listOf(DifficultyFactor.REVIEW), 0, mapOf(DifficultyFactor.STRUCTURE to 2.5f))
        val b = calc.calculate(bare.copy(serverDifficulty = sd), VehicleSize.SUV)
        assertTrue(b.insufficient && b.fromServer); assertEquals(2.5f, b.structure!!, 0f)
    }

    @Test fun serverDifficultyPassthrough() {
        val sd = ServerDifficulty(2.5f, true, "v1", listOf(DifficultyFactor.REVIEW), 3)
        val b = calc.calculate(bare.copy(serverDifficulty = sd), VehicleSize.SUV)
        assertEquals(2.5f, b.forMyCar, 0f)
        assertTrue(b.fromServer && b.structure == null)
        assertEquals(listOf(DifficultyFactor.REVIEW), b.missing)
    }

    @Test fun missingFactorsRenormalised() {
        val b = calc.calculate(bare.copy(reviewDifficulty = 4f), VehicleSize.MIDSIZE)
        assertEquals(4f, b.base, 0.001f)
        assertEquals(3, b.missing.size)
        val two = calc.calculate(bare.copy(reviewDifficulty = 5f, builtYear = 2026), VehicleSize.MIDSIZE)
        assertEquals((0.25f * 5f + 0.15f * 1f) / 0.40f, two.base, 0.001f)
    }

    @Test fun allUnknownIsThree() {
        val b = calc.calculate(bare, VehicleSize.SUV)
        assertEquals(3f, b.forMyCar, 0f)
        assertEquals(4, b.missing.size)
    }

    @Test fun biggerSizeNeverLowersScore() {
        for (l in repo.lots.value + bare) {
            val s = VehicleSize.entries.map { calc.calculate(l, it).forMyCar }
            assertEquals(s.sorted(), s)
        }
    }
}
