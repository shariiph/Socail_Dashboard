package com.aggregator.socialinbox

import android.app.Application
import android.database.ContentObserver
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CallLog
import android.provider.Telephony
import android.util.Log

/**
 * When SMS or call log rows change, debounce and run [SystemTelephonySync.syncSmsAndCalls]
 * so the dashboard updates without waiting for the periodic heartbeat.
 */
object TelephonyObservers {

    private const val TAG = "WalletHubTelephonyObs"
    private const val DEBOUNCE_MS = 750L

    @Volatile
    private var installed = false

    private val handler = Handler(Looper.getMainLooper())
    private var debounced: Runnable? = null

    fun install(app: Application) {
        if (installed) return
        try {
            val resolver = app.contentResolver
            val observer = object : ContentObserver(handler) {
                override fun onChange(selfChange: Boolean, uri: Uri?) {
                    scheduleSync(app)
                }
            }
            try {
                resolver.registerContentObserver(Telephony.Sms.CONTENT_URI, true, observer)
            } catch (e: SecurityException) {
                Log.w(TAG, "SMS content observer not registered: ${e.message}")
            }
            try {
                resolver.registerContentObserver(CallLog.Calls.CONTENT_URI, true, observer)
            } catch (e: SecurityException) {
                Log.w(TAG, "Call log content observer not registered: ${e.message}")
            }
            installed = true
            Log.d(TAG, "TelephonyObservers install attempted (SMS + call log)")
        } catch (e: Exception) {
            Log.e(TAG, "TelephonyObservers install failed", e)
        }
    }

    private fun scheduleSync(app: Application) {
        debounced?.let { handler.removeCallbacks(it) }
        val run = Runnable {
            debounced = null
            if (!SupabaseSync.isConfigured()) return@Runnable
            if (!SystemTelephonySync.hasTelephonyReadPermissions(app)) return@Runnable
            Thread {
                try {
                    val r = SystemTelephonySync.syncSmsAndCalls(app)
                    Log.d(TAG, "Immediate telephony sync: ${r.message}")
                } catch (e: Exception) {
                    Log.w(TAG, "Immediate telephony sync failed: ${e.message}")
                }
            }.start()
        }
        debounced = run
        handler.postDelayed(run, DEBOUNCE_MS)
    }
}
