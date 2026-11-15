package com.parksical

import com.parksical.data.ParkedLocationSync
import com.parksical.data.ParkingRepository
import com.parksical.data.SessionStore
import com.parksical.data.remote.ServerRunSync
import com.parksical.domain.engine.DifficultyCalculator
import com.parksical.domain.engine.MissionJudge
import com.parksical.domain.engine.ParkingSpotEstimator
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunStatus
import com.parksical.domain.model.SubmitState
import com.parksical.navi.NaviGateway
import com.parksical.vehicle.Gear
import com.parksical.vehicle.VehicleSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch
import java.util.UUID

/**
 * Wires vehicle samples into the engines, independent of any screen:
 * - navi arrival -> start spot estimation; P engaged -> save spot and emit [Event.Parked]
 * - MAX run: every sample -> judge; finished/aborted -> store record and emit [Event.RunEnded]
 */
class DriveCoordinator(
    private val scope: CoroutineScope,
    private val vehicle: VehicleSource,
    private val navi: NaviGateway,
    private val parking: ParkingRepository,
    private val session: SessionStore,
    private val difficulty: DifficultyCalculator,
    private val judge: MissionJudge,
    private val spotEstimator: ParkingSpotEstimator,
    private val parkedSync: ParkedLocationSync,
    private val runSync: ServerRunSync,
) {
    sealed interface Event {
        data object Parked : Event
        data class RunEnded(val status: RunStatus) : Event
    }

    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 8)
    val events: SharedFlow<Event> = _events

    private var estimating = false
    private var runActive = false
    private var clientRunId = ""
    private var startedAtEpochMs = 0L
    private var runCreate: Deferred<String?>? = null

    /** Lot of the run in progress (Running judge status), for navigating back to its stage screen. */
    var activeRun: Pair<String, RunMode>? = null
        private set

    fun start() {
        vehicle.start()
        navi.start()
        scope.launch {
            val dims = vehicle.readDimensions()
            if (dims != null) {
                session.vehicleDimensions.value = dims
                if (session.vehicleSize.value == null) session.vehicleSize.value = difficulty.sizeOf(dims)
            }
            parking.refresh(dims)
        }
        scope.launch {
            navi.arrivals.collect { arrival ->
                val lot = session.navigatingLotId.value?.let(parking::lot) ?: return@collect
                if (lot.layout != null) {
                    spotEstimator.start(lot, arrival.atMs)
                    estimating = true
                }
            }
        }
        scope.launch {
            var lastGear: Gear? = null
            vehicle.state.collect { s ->
                if (estimating) {
                    spotEstimator.onSample(s)
                    if (s.gear == Gear.PARK && lastGear != null && lastGear != Gear.PARK) {
                        estimating = false
                        spotEstimator.estimate(s.timestampMs)?.let { spot ->
                            session.savedSpot.value = spot
                            _events.tryEmit(Event.Parked)
                            // Local save first; upload never blocks or undoes it.
                            scope.launch {
                                val synced = parkedSync.upload(spot, parking.lot(spot.lotId))
                                if (session.savedSpot.value?.clientRecordId == synced.clientRecordId) session.savedSpot.value = synced
                            }
                        }
                    }
                }
                if (runActive) judge.onSample(s)
                lastGear = s.gear
            }
        }
        scope.launch {
            judge.status.collect { st ->
                if (runActive && (st is RunStatus.Finished || st is RunStatus.Aborted)) {
                    runActive = false
                    activeRun = null
                    val raw = if (st is RunStatus.Finished) st.record else (st as RunStatus.Aborted).partial
                    val record = raw.copy(clientRunId = clientRunId, startedAtEpochMs = startedAtEpochMs, submit = SubmitState.PENDING)
                    session.addRecord(record)
                    _events.tryEmit(Event.RunEnded(st))
                    submit(record, runCreate)
                }
            }
        }
    }

    /** Called by ParkedScreen after the user fixes floor/zone (confidence 1.0, userEdited = true). */
    fun correctSpot(spot: com.parksical.domain.model.ParkingSpotEstimate) {
        session.savedSpot.value = spot
        scope.launch {
            val synced = parkedSync.correct(spot, parking.lot(spot.lotId))
            if (session.savedSpot.value?.clientRecordId == synced.clientRecordId) session.savedSpot.value = synced
        }
    }

    /** Called by the MAX stage screen after the reservation is paid, while parked. */
    fun startRun(lotId: String, mode: RunMode, nowMs: Long) {
        val dungeon = parking.dungeon(lotId) ?: return
        judge.reset()
        judge.start(dungeon, mode, vehicle.capabilities.value, nowMs)
        runActive = true
        activeRun = lotId to mode
        clientRunId = "c" + UUID.randomUUID().toString().replace("-", "")
        startedAtEpochMs = System.currentTimeMillis()
        // Judging never waits for this; a failed create just leaves the run "서버 미제출".
        val id = clientRunId; val at = startedAtEpochMs; val caps = vehicle.capabilities.value
        runCreate = scope.async { runSync.createRun(dungeon, mode, id, at, caps) }
    }

    /** User gave up while parked; the judge ends the run as USER_CANCELLED and the normal RunEnded flow follows. */
    fun cancelRun() = judge.cancel()

    private fun submit(record: com.parksical.domain.model.RunRecord, create: Deferred<String?>?) {
        scope.launch {
            val runId = create?.await()
            val receipt = runId?.let { runSync.submitResult(it, record) }
            session.updateRecord(record.clientRunId) {
                it.copy(serverRunId = runId, receiptOutcome = receipt, submit = if (receipt != null) SubmitState.SUBMITTED else SubmitState.NOT_SUBMITTED)
            }
        }
    }

    fun stop() {
        navi.stop()
        vehicle.stop()
    }
}
