package com.aggregator.socialinbox

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Restarts the dashboard heartbeat after reboot so the device can show as online
 * without opening the app (if notification access is still enabled).
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!DashboardHeartbeatService.allowed(context.applicationContext)) {
            Log.d("WalletHubBoot", "Heartbeat not started after boot (listener or config)")
            return
        }
        val app = context.applicationContext
        DashboardHeartbeatService.start(app)
        WatchdogScheduler.schedule(app)
    }
}
