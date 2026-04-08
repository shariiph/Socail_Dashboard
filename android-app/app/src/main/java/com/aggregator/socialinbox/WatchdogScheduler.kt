package com.aggregator.socialinbox

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log

/**
 * Schedules a repeating system alarm so if an OEM kills our process, Android can wake and
 * restart [DashboardHeartbeatService] without opening the app. Chains one-shot alarms.
 *
 * This is not a replacement for OEM-specific "Autostart" toggles, but improves recovery on stock-like devices.
 */
object WatchdogScheduler {

    private const val TAG = "WalletHubWatchdog"
    private const val INTERVAL_MS = 4 * 60 * 1000L

    fun schedule(context: Context) {
        val app = context.applicationContext
        if (!DashboardHeartbeatService.allowed(app)) {
            Log.d(TAG, "schedule skipped — preconditions not met")
            return
        }
        val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pendingIntent(app)
        val triggerElapsed = SystemClock.elapsedRealtime() + INTERVAL_MS
        try {
            when {
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
                    if (am.canScheduleExactAlarms()) {
                        am.setExactAndAllowWhileIdle(
                            AlarmManager.ELAPSED_REALTIME_WAKEUP,
                            triggerElapsed,
                            pi
                        )
                    } else {
                        am.setAndAllowWhileIdle(
                            AlarmManager.ELAPSED_REALTIME_WAKEUP,
                            triggerElapsed,
                            pi
                        )
                    }
                }
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M -> {
                    am.setAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        triggerElapsed,
                        pi
                    )
                }
                else -> {
                    @Suppress("DEPRECATION")
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerElapsed, pi)
                }
            }
        } catch (e: SecurityException) {
            Log.w(TAG, "Alarm schedule fallback: ${e.message}")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(
                    AlarmManager.ELAPSED_REALTIME_WAKEUP,
                    triggerElapsed,
                    pi
                )
            }
        }
    }

    fun cancel(context: Context) {
        val app = context.applicationContext
        val am = app.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val pi = pendingIntent(app)
        am.cancel(pi)
        pi.cancel()
        Log.d(TAG, "Watchdog alarm cancelled")
    }

    private fun pendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, WatchdogReceiver::class.java)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_IMMUTABLE
            } else {
                0
            }
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }
}
