package com.aggregator.socialinbox

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Periodic backup sync for SMS + call log when the foreground service is delayed by Doze/OEM.
 */
class TelephonySyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        if (!SupabaseSync.isConfigured()) return@withContext Result.success()
        if (!SystemTelephonySync.hasTelephonyReadPermissions(applicationContext)) {
            return@withContext Result.success()
        }
        return@withContext try {
            val r = SystemTelephonySync.syncSmsAndCalls(applicationContext)
            if (r.success) Result.success() else Result.retry()
        } catch (e: Exception) {
            Result.retry()
        }
    }
}
