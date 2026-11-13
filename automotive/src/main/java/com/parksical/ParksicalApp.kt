package com.parksical

import android.app.Application

class ParksicalApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
        container.drive.start()
    }
}
