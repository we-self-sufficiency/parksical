package com.parksical.vehicle

enum class Gear { PARK, REVERSE, NEUTRAL, DRIVE, UNKNOWN }

/** One snapshot of everything the app reads from the car. Emitted on every property change. */
data class VehicleState(
    val gear: Gear = Gear.PARK,
    val speedKmh: Float = 0f,
    /** Steering wheel angle in degrees, + = left (Pleos SDK convention, range about -540..540). */
    val steeringDeg: Float = 0f,
    val brakePressed: Boolean = false,
    /** CarUxRestrictions.isRequiresDistractionOptimization(): true while driving. */
    val uxRestricted: Boolean = false,
    /** True once any seat airbag has deployed. */
    val airbagDeployed: Boolean = false,
    /** True while any door, the hood (frunk) or the trunk is open. */
    val doorOpen: Boolean = false,
    val timestampMs: Long = 0L,
) {
    /** Entry buttons, confirm dialogs, payment and results are only allowed in this state. */
    val isParked: Boolean get() = gear == Gear.PARK
}

/** Which inputs this car actually provides. Missions whose input is missing are hidden. */
data class VehicleCapabilities(
    val gear: Boolean = false,
    val speed: Boolean = false,
    val steering: Boolean = false,
    val brake: Boolean = false,
    val airbag: Boolean = false,
    val doors: Boolean = false,
)

data class VehicleDimensions(val lengthMm: Int, val widthMm: Int)
