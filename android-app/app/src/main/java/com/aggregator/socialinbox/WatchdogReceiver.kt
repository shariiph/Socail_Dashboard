package com.aggregator.socialinbox

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Fires on AlarmManager schedule to restart the foreground heartbeat if the process was killed.
 */
class WatchdogReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val app = context.applicationContext
        if (!DashboardHeartbeatService.allowed(app)) {
            Log.d("WalletHubWatchdog", "Tick: preconditions not met, not restarting")
            WatchdogScheduler.cancel(app)
            return
        }
        Log.d("WalletHubWatchdog", "Tick: restarting dashboard connection")
        DashboardHeartbeatService.start(app)
        WatchdogScheduler.schedule(app)
    }
}
