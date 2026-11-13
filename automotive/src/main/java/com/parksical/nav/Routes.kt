package com.parksical.nav

import com.parksical.domain.model.RunMode

object Routes {
    const val HOME = "home"
    const val LOT_DETAIL = "lot/{lotId}"
    const val PARKED = "parked"
    const val MAX_STAGE = "max/stage/{lotId}/{mode}"
    const val MAX_RESULT = "max/result"
    const val MAX_PRACTICE_REPORT = "max/practice/{lotId}"

    fun lotDetail(lotId: String) = "lot/$lotId"
    fun maxStage(lotId: String, mode: RunMode) = "max/stage/$lotId/${mode.name}"
    fun practiceReport(lotId: String) = "max/practice/$lotId"
}
