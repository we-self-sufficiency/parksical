package com.parksical.domain.engine

import com.parksical.data.MockParkingRepository
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleDimensions
import org.junit.Assert.assertEquals
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
        assertEquals(4.8f, b.structure, 0.6f)
        assertEquals(4.3f, b.review, 0.01f)
        assertEquals(4.5f, b.driving, 0.6f)
        assertEquals(4.0f, b.age, 0.6f)
    }

    @Test fun sizeOfDimensions() {
        assertEquals(VehicleSize.COMPACT, calc.sizeOf(VehicleDimensions(3600, 1600)))
        assertEquals(VehicleSize.MIDSIZE, calc.sizeOf(VehicleDimensions(4600, 1830)))
        assertEquals(VehicleSize.LARGE_SEDAN, calc.sizeOf(VehicleDimensions(5000, 1880)))
        assertEquals(VehicleSize.SUV, calc.sizeOf(VehicleDimensions(5200, 1990)))
    }
}
