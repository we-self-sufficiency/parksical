package com.parksical.domain.engine

import com.parksical.domain.model.DifficultyBreakdown
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleDimensions

/** Phase 0 stub. Owner: agent B (domain engines). */
class DefaultDifficultyCalculator : DifficultyCalculator {
    override fun calculate(lot: ParkingLot, size: VehicleSize) =
        DifficultyBreakdown(lot.reviewDifficulty, lot.reviewDifficulty, lot.reviewDifficulty, lot.reviewDifficulty,
            lot.reviewDifficulty, lot.reviewDifficulty, size)

    override fun sizeOf(dimensions: VehicleDimensions) = VehicleSize.MIDSIZE
}
