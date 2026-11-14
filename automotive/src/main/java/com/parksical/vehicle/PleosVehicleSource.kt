package com.parksical.vehicle

import ai.pleos.playground.vehicle.Vehicle
import ai.pleos.playground.vehicle.api.model.capability.AccessType
import ai.pleos.playground.vehicle.api.model.area.SeatArea
import ai.pleos.playground.vehicle.listener.BrakePedalStatusListener
import ai.pleos.playground.vehicle.listener.SeatAirbagDeployedListener
import ai.pleos.playground.vehicle.listener.SteeringWheelAngleListener
import android.car.Car
import android.car.VehicleGear
import android.car.VehiclePropertyIds
import android.car.drivingstate.CarUxRestrictions
import android.car.drivingstate.CarUxRestrictionsManager
import android.car.hardware.CarPropertyValue
import android.car.hardware.property.CarPropertyManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

private const val TAG = "PleosVehicleSource"

/**
 * AAOS gear/speed/UX restrictions + Pleos steering/brake -> [VehicleState].
 * Every input is optional: a missing service/property is logged and its capability stays false.
 */
class PleosVehicleSource(private val context: Context) : VehicleSource {
    private val _state = MutableStateFlow(VehicleState())
    override val state: StateFlow<VehicleState> = _state
    private val _capabilities = MutableStateFlow(VehicleCapabilities())
    override val capabilities: StateFlow<VehicleCapabilities> = _capabilities

    private val lock = Any()
    private var raw = VehicleState()
    private var started = false
    @Volatile private var speedReal = false
    private var scope: CoroutineScope? = null

    private var car: Car? = null
    private var propMgr: CarPropertyManager? = null
    private var uxMgr: CarUxRestrictionsManager? = null
    private var vehicle: Vehicle? = null

    /** Callbacks may arrive on binder threads; all mutation goes through [lock]. */
    private fun update(transform: (VehicleState) -> VehicleState) = synchronized(lock) {
        raw = transform(raw).copy(timestampMs = SystemClock.elapsedRealtime())
        publish()
    }

    private fun publish() {
        val s = DebugSpeedOverride.kmh.value?.let { raw.copy(speedKmh = it) } ?: raw
        _state.value = s
    }

    private fun setCap(t: (VehicleCapabilities) -> VehicleCapabilities) = _capabilities.update(t)

    private fun <T> MutableStateFlow<T>.update(f: (T) -> T) {
        while (true) { val o = value; if (compareAndSet(o, f(o))) return }
    }

    private val propCallback = object : CarPropertyManager.CarPropertyEventCallback {
        override fun onChangeEvent(value: CarPropertyValue<*>) = applyProperty(value.propertyId, value.value)
        override fun onErrorEvent(propId: Int, zone: Int) { Log.w(TAG, "property error id=$propId zone=$zone") }
    }

    private fun applyProperty(id: Int, v: Any?) {
        when (id) {
            VehiclePropertyIds.GEAR_SELECTION -> (v as? Int)?.let { g -> update { it.copy(gear = mapGear(g)) } }
            VehiclePropertyIds.PERF_VEHICLE_SPEED -> (v as? Float)?.let { ms -> update { it.copy(speedKmh = ms * 3.6f) } }
        }
    }

    override fun start() {
        synchronized(lock) {
            if (started) return
            started = true
        }
        val sc = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        scope = sc
        // Re-emit immediately when the debug override changes.
        // Debug override also counts as a speed input, otherwise speed missions are skipped on the emulator (no speed property).
        sc.launch {
            DebugSpeedOverride.kmh.collect { o ->
                setCap { it.copy(speed = speedReal || o != null) }
                synchronized(lock) { publish() }
            }
        }
        startPleos()
        try {
            Car.createCar(context, Handler(Looper.getMainLooper()), 5000L) { c, ready ->
                if (ready) onCarReady(c) else Log.w(TAG, "Car service disconnected")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Car.createCar failed", t)
        }
    }

    private fun onCarReady(c: Car) {
        car = c
        try {
            val pm = c.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager
            propMgr = pm
            if (pm == null) Log.w(TAG, "CarPropertyManager missing") else {
                registerProp(pm, VehiclePropertyIds.GEAR_SELECTION, CarPropertyManager.SENSOR_RATE_ONCHANGE) { v ->
                    setCap { it.copy(gear = true) }; applyProperty(VehiclePropertyIds.GEAR_SELECTION, v)
                    Log.i(TAG, "gear initial=$v")
                }
                registerProp(pm, VehiclePropertyIds.PERF_VEHICLE_SPEED, CarPropertyManager.SENSOR_RATE_NORMAL) { v ->
                    speedReal = true; setCap { it.copy(speed = true) }; applyProperty(VehiclePropertyIds.PERF_VEHICLE_SPEED, v)
                }
            }
        } catch (t: Throwable) {
            Log.w(TAG, "property setup failed", t)
        }
        try {
            val ux = c.getCarManager(Car.CAR_UX_RESTRICTION_SERVICE) as? CarUxRestrictionsManager
            uxMgr = ux
            ux?.registerListener { r: CarUxRestrictions -> setUx(r) }
            ux?.currentCarUxRestrictions?.let { setUx(it) }
        } catch (t: Throwable) {
            Log.w(TAG, "ux restrictions setup failed", t)
        }
    }

    private fun setUx(r: CarUxRestrictions) = update { it.copy(uxRestricted = r.isRequiresDistractionOptimization) }

    private fun registerProp(pm: CarPropertyManager, id: Int, rate: Float, onInitial: (Any?) -> Unit) {
        try {
            val p = pm.getProperty<Any>(id, 0)
            if (p == null) { Log.w(TAG, "property $id unavailable"); return }
            onInitial(p.value)
            if (!pm.registerCallback(propCallback, id, rate)) Log.w(TAG, "registerCallback false for $id")
        } catch (t: Throwable) {
            Log.w(TAG, "property $id unavailable", t)
        }
    }

    private fun startPleos() {
        try {
            val v = Vehicle(context).also { it.initialize() }
            vehicle = v
            v.getSteeringWheel().apply {
                checkSteeringWheelAngleCapabilities({ cfg, _ ->
                    val ok = cfg.accessType != AccessType.NONE
                    setCap { it.copy(steering = ok) }
                    Log.i(TAG, "steering capability=$ok")
                }, { Log.w(TAG, "steering capability check failed", it) })
                registerSteeringWheelAngle(steeringListener)
            }
            v.getBrake().apply {
                checkBrakePedalStatusCapabilities({ cfg ->
                    val ok = cfg.accessType != AccessType.NONE
                    setCap { it.copy(brake = ok) }
                    Log.i(TAG, "brake capability=$ok")
                }, { Log.w(TAG, "brake capability check failed", it) })
                registerBrakePedalStatus(brakeListener)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "Pleos Vehicle SDK unavailable", t)
        }
        startAirbag()
    }

    private val airbagListeners = mutableListOf<Pair<SeatArea, SeatAirbagDeployedListener>>()
    private val airbagByArea = mutableMapOf<Int, Boolean>()

    private fun startAirbag() {
        try {
            val safety = vehicle?.getSafety() ?: return
            safety.checkAirbagDeployedCapabilities({ cfg, areas ->
                val ok = cfg.accessType != AccessType.NONE
                setCap { it.copy(airbag = ok) }
                Log.i(TAG, "airbag capability=$ok areas=${areas.size}")
                if (!ok) return@checkAirbagDeployedCapabilities
                areas.forEachIndexed { i, area ->
                    val l = object : SeatAirbagDeployedListener {
                        override fun onSeatAirbagDeployUpdated(deployed: Boolean?) {
                            if (deployed == null) return
                            synchronized(airbagByArea) {
                                airbagByArea[i] = deployed
                                val any = airbagByArea.values.any { it }
                                update { it.copy(airbagDeployed = any) }
                            }
                        }
                        override fun onFailed(e: Exception) { Log.w(TAG, "airbag listener failed", e) }
                    }
                    try {
                        safety.registerSeatAirbagDeployed(area, l)
                        synchronized(airbagListeners) { airbagListeners += area to l }
                    } catch (t: Throwable) { Log.w(TAG, "airbag register failed", t) }
                }
            }, { Log.w(TAG, "airbag capability check failed", it) })
        } catch (t: Throwable) {
            Log.w(TAG, "airbag setup failed", t)
        }
    }

    private val steeringListener = object : SteeringWheelAngleListener {
        override fun onSteeringWheelAngleUpdated(angle: Float?) {
            if (angle != null) update { it.copy(steeringDeg = angle) }
        }
        override fun onFailed(e: Exception) { Log.w(TAG, "steering listener failed", e) }
    }
    private val brakeListener = object : BrakePedalStatusListener {
        override fun onBrakePedalStatusUpdated(status: Boolean?) {
            if (status != null) update { it.copy(brakePressed = status) }
        }
        override fun onFailed(e: Exception) { Log.w(TAG, "brake listener failed", e) }
    }

    override fun stop() {
        synchronized(lock) {
            if (!started) return
            started = false
        }
        scope?.cancel(); scope = null
        runCatching { propMgr?.unregisterCallback(propCallback) }
        runCatching { vehicle?.getSteeringWheel()?.unregisterSteeringWheelAngle(steeringListener) }
        runCatching { vehicle?.getBrake()?.unregisterBrakePedalStatus(brakeListener) }
        synchronized(airbagListeners) {
            airbagListeners.forEach { (a, l) -> runCatching { vehicle?.getSafety()?.unregisterSeatAirbagDeployed(a, l) } }
            airbagListeners.clear()
        }
        runCatching { vehicle?.release() }
        runCatching { car?.disconnect() }
        vehicle = null; car = null; propMgr = null; uxMgr = null
    }

    override suspend fun readDimensions(): VehicleDimensions? = try {
        val pm = propMgr ?: (car?.getCarManager(Car.PROPERTY_SERVICE) as? CarPropertyManager)
        val v = pm?.getProperty<Any>(VehiclePropertyIds.INFO_EXTERIOR_DIMENSIONS, 0)?.value
        // Property is int[] (or Integer[]) in mm: 0 height, 1 length, 2 width.
        val a: List<Int>? = when (v) {
            is IntArray -> v.toList()
            is Array<*> -> v.map { (it as Number).toInt() }
            else -> null
        }
        if (a != null && a.size >= 3 && a[1] > 0 && a[2] > 0) VehicleDimensions(a[1], a[2]) else null
    } catch (t: Throwable) {
        Log.w(TAG, "readDimensions failed", t); null
    }
}

internal fun mapGear(g: Int): Gear = when (g) {
    VehicleGear.GEAR_PARK -> Gear.PARK
    VehicleGear.GEAR_REVERSE -> Gear.REVERSE
    VehicleGear.GEAR_NEUTRAL -> Gear.NEUTRAL
    VehicleGear.GEAR_DRIVE -> Gear.DRIVE
    // Numbered gears GEAR_1..GEAR_9 are bit values 16..4096 (not exposed in android.car.VehicleGear).
    in 16..4096 -> Gear.DRIVE
    else -> Gear.UNKNOWN
}
