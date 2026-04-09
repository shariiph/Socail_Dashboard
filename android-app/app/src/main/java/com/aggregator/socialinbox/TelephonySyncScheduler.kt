package com.aggregator.socialinbox

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Periodic backup for SMS/call sync when the foreground service is throttled (Doze, OEM).
 */
object TelephonySyncScheduler {

    private const val UNIQUE = "telephony_backup_sync"

    fun schedule(context: Context) {
        val app = context.applicationContext
        if (!SupabaseSync.isConfigured()) return
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()
        val work = PeriodicWorkRequestBuilder<TelephonySyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()
        WorkManager.getInstance(app).enqueueUniquePeriodicWork(
            UNIQUE,
            ExistingPeriodicWorkPolicy.KEEP,
            work
        )
    }
}
