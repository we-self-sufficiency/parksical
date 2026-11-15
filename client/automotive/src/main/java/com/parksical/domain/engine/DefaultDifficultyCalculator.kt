package com.parksical.domain.engine

import com.parksical.domain.model.DifficultyBreakdown
import com.parksical.domain.model.DifficultyFactor
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
        lot.serverDifficulty?.let {
            val f = it.factorScores
            val s = it.score ?: 0f
            return DifficultyBreakdown(
                f[DifficultyFactor.STRUCTURE], f[DifficultyFactor.REVIEW], f[DifficultyFactor.DRIVING_STATS], f[DifficultyFactor.BUILDING_AGE],
                s, s, size, it.missingFactors, fromServer = true, insufficient = it.score == null,
            )
        }
        val structure = lot.structure?.let(::structureScore)
        val review = lot.reviewDifficulty?.coerceIn(1f, 5f)
        // Gear shifts and park seconds weigh equally; use whichever is known.
        val driving = listOfNotNull(
            lot.avgGearShifts?.let { lerp(it, 1f, 5.4f) },
            lot.avgParkSeconds?.let { lerp(it.toFloat(), 30f, 170f) },
        ).takeIf { it.isNotEmpty() }?.average()?.toFloat()
        val age = lot.builtYear?.let { (1f + (currentYear - it) / 11f).coerceIn(1f, 5f) }

        val known = listOf(
            Triple(DifficultyFactor.STRUCTURE, structure, 0.40f), Triple(DifficultyFactor.REVIEW, review, 0.25f),
            Triple(DifficultyFactor.DRIVING_STATS, driving, 0.20f), Triple(DifficultyFactor.BUILDING_AGE, age, 0.15f),
        )
        val missing = known.filter { it.second == null }.map { it.first }
        val weight = known.sumOf { if (it.second != null) it.third.toDouble() else 0.0 }.toFloat()
        val base = if (weight == 0f) 3f else known.sumOf { ((it.second ?: 0f) * it.third).toDouble() }.toFloat() / weight

        val maxSize = lot.structure?.maxSize
        val stars = if (maxSize != null && size > maxSize) 5f else {
            // Size matters only on narrow lots: 0 at structure 2, full at structure >= 4.3; unknown structure = no scaling.
            val narrow = if (structure == null) 0f else ((structure - 2f) / 2.3f).coerceIn(0f, 1f)
            val delta = when (size) {
                VehicleSize.COMPACT -> -0.75f
                VehicleSize.MIDSIZE -> 0f
                VehicleSize.LARGE_SEDAN -> 0.5f
                VehicleSize.SUV -> 1.0f
            }
            ((base + delta * narrow) * 2).roundToInt() / 2f
        }.coerceIn(1f, 5f)
        return DifficultyBreakdown(structure, review, driving, age, base, stars, size, missing)
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
