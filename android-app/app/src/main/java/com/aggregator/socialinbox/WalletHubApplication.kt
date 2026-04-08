package com.aggregator.socialinbox

import android.app.Application

/**
 * Ensures the dashboard heartbeat foreground service is (re)started whenever this process
 * starts — e.g. after the user opens the app or the system restarts the process.
 */
class WalletHubApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        try {
            TelephonyObservers.install(this)
        } catch (e: Exception) {
            android.util.Log.e("WalletHubApplication", "TelephonyObservers", e)
        }
        if (DashboardHeartbeatService.allowed(this)) {
            DashboardHeartbeatService.start(this)
            WatchdogScheduler.schedule(this)
        } else {
            WatchdogScheduler.cancel(this)
        }
    }
}
