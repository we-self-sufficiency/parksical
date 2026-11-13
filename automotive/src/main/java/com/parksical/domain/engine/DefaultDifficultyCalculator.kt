package com.parksical.domain.engine

import com.parksical.domain.model.DifficultyBreakdown
import com.parksical.domain.model.LotStructure
import com.parksical.domain.model.ParkingLot
import com.parksical.domain.model.RampType
import com.parksical.domain.model.VehicleSize
import com.parksical.vehicle.VehicleDimensions
import kotlin.math.roundToInt

/**
 * All factor scores are linear maps onto 1..5 (higher = harder), tuned so the mock lots land on the
 * mockup values (daon ≈ 구조 4.3 / 리뷰 4.3 / 주행 4.0 / 연식 3.6).
 */
class DefaultDifficultyCalculator(private val currentYear: Int = 2026) : DifficultyCalculator {

    override fun calculate(lot: ParkingLot, size: VehicleSize): DifficultyBreakdown {
        val structure = structureScore(lot.structure)
        val review = lot.reviewDifficulty.coerceIn(1f, 5f)
        // Gear shifts and park seconds weigh equally.
        val driving = (lerp(lot.avgGearShifts, 1f, 5.4f) + lerp(lot.avgParkSeconds.toFloat(), 30f, 170f)) / 2f
        val age = (1f + (currentYear - lot.builtYear) / 11f).coerceIn(1f, 5f)
        val base = 0.40f * structure + 0.25f * review + 0.20f * driving + 0.15f * age

        val maxSize = lot.structure.maxSize
        val stars = if (maxSize != null && size > maxSize) 5f else {
            // Size matters only on narrow lots: 0 at structure 2, full at structure >= 4.3.
            val narrow = ((structure - 2f) / 2.3f).coerceIn(0f, 1f)
            val delta = when (size) {
                VehicleSize.COMPACT -> -0.75f
                VehicleSize.MIDSIZE -> 0f
                VehicleSize.LARGE_SEDAN -> 0.5f
                VehicleSize.SUV -> 1.0f
            }
            ((base + delta * narrow) * 2).roundToInt() / 2f
        }.coerceIn(1f, 5f)
        return DifficultyBreakdown(structure, review, driving, age, base, stars, size)
    }

    override fun sizeOf(dimensions: VehicleDimensions) = when {
        dimensions.lengthMm >= 5100 || dimensions.widthMm >= 1950 -> VehicleSize.SUV
        dimensions.lengthMm >= 4800 -> VehicleSize.LARGE_SEDAN
        dimensions.lengthMm >= 4000 && dimensions.widthMm >= 1700 -> VehicleSize.MIDSIZE
        else -> VehicleSize.COMPACT
    }

    private fun structureScore(s: LotStructure): Float {
        val entrance = lerp(s.entranceWidthM, 6.5f, 2.6f)
        val bay = lerp(s.bayWidthM, 2.6f, 2.0f)
        val pillar = 1f + 4f * s.pillarDensity
        val ramp = when (s.rampType) {
            RampType.FLAT -> 1f
            RampType.STRAIGHT -> 2.5f
            RampType.SPIRAL -> 3.5f + 0.75f * s.rampTurnsPerFloor
            RampType.MECHANICAL -> 5f
        }.coerceAtMost(5f)
        return 0.3f * entrance + 0.3f * ramp + 0.2f * pillar + 0.2f * bay
    }

    /** Maps [v] linearly from [easy]→1 to [hard]→5, clamped. */
    private fun lerp(v: Float, easy: Float, hard: Float) = (1f + 4f * (v - easy) / (hard - easy)).coerceIn(1f, 5f)
}
