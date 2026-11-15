package com.parksical

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Runs only while a MAX run is active. Engaging R opens the rear camera over the app, Android then marks the
 * process cached and freezes it, and the judge stops getting samples mid-stage. A foreground service prevents that.
 */
class RunKeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "P지컬 MAX 판정", NotificationManager.IMPORTANCE_LOW))
        val n = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("P지컬 MAX 판정 중")
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(ID, n)
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "max_run"
        private const val ID = 1

        fun set(context: Context, active: Boolean) {
            val i = Intent(context, RunKeepAliveService::class.java)
            if (active) context.startForegroundService(i) else context.stopService(i)
        }
    }
}
