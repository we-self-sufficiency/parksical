package com.parksical.domain.engine

import com.parksical.domain.model.Dungeon
import com.parksical.domain.model.RunMode
import com.parksical.domain.model.RunStatus
import com.parksical.vehicle.VehicleCapabilities
import com.parksical.vehicle.VehicleState
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Phase 0 stub. Owner: agent B (domain engines). */
class DefaultMissionJudge : MissionJudge {
    private val _status = MutableStateFlow<RunStatus>(RunStatus.Idle)
    override val status: StateFlow<RunStatus> = _status
    override fun start(dungeon: Dungeon, mode: RunMode, capabilities: VehicleCapabilities, nowMs: Long) {}
    override fun onSample(state: VehicleState) {}
    override fun reset() { _status.value = RunStatus.Idle }
}
