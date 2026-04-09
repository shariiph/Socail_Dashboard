package com.aggregator.socialinbox

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import org.json.JSONObject
import java.net.UnknownHostException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Registers this phone in Supabase `devices` so the web dashboard can show it.
 * Uses the same URL/key as [InboxNotificationService] (from BuildConfig).
 */
object SupabaseSync {

    fun supabaseBaseUrl(): String = BuildConfig.SUPABASE_URL.trim().trimEnd('/')

    fun apiKey(): String = when {
        BuildConfig.SUPABASE_SERVICE_ROLE_KEY.isNotBlank() -> BuildConfig.SUPABASE_SERVICE_ROLE_KEY
        else -> BuildConfig.SUPABASE_ANON_KEY
    }

    fun isConfigured(): Boolean = supabaseBaseUrl().isNotBlank() && apiKey().isNotBlank()

    /**
     * Synchronous POST /devices upsert. Call from a background thread before inserting into
     * [messages] — that table references [devices], and PostgREST will reject rows if the device
     * row does not exist yet.
     */
    fun ensureDeviceRegistered(context: Context): Boolean {
        if (!isConfigured()) return false
        val app = context.applicationContext
        return try {
            val deviceId =
                Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID)
                    ?: return false
            val deviceName = DeviceIdentity.displayName(app)
            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            val timestamp = sdf.format(Date())

            val json = JSONObject().apply {
                put("id", deviceId)
                put("device_name", deviceName)
                put("last_seen", timestamp)
                put("is_online", true)
            }

            val key = apiKey()
            val url = "${supabaseBaseUrl()}/rest/v1/devices?on_conflict=id"

            SupabaseHttp.postJsonWithRetry(url, key, json.toString()).use { response ->
                if (!response.isSuccessful) {
                    val respBody = response.body?.string().orEmpty()
                    Log.e("SocialInbox", "ensureDeviceRegistered HTTP ${response.code}: ${respBody.take(400)}")
                }
                response.isSuccessful
            }
        } catch (e: Exception) {
            Log.e("SocialInbox", "ensureDeviceRegistered: ${e.message}", e)
            false
        }
    }

    /**
     * POST /devices upsert. Runs network work off the main thread; [callback] runs on main thread.
     */
    fun registerDeviceWithDashboard(
        context: Context,
        callback: ((success: Boolean, message: String) -> Unit)? = null
    ) {
        if (!isConfigured()) {
            val msg = "Missing Supabase URL or key. Add them to local.properties and rebuild the APK."
            Log.e("SocialInbox", msg)
            runMain { callback?.invoke(false, msg) }
            return
        }

        val app = context.applicationContext
        Thread {
            try {
                val deviceId =
                    Settings.Secure.getString(app.contentResolver, Settings.Secure.ANDROID_ID)
                        ?: "unknown_device"
                val deviceName = DeviceIdentity.displayName(app)
                val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                sdf.timeZone = TimeZone.getTimeZone("UTC")
                val timestamp = sdf.format(Date())

                val json = JSONObject().apply {
                    put("id", deviceId)
                    put("device_name", deviceName)
                    put("last_seen", timestamp)
                    put("is_online", true)
                }

                val key = apiKey()
                val url = "${supabaseBaseUrl()}/rest/v1/devices?on_conflict=id"

                SupabaseHttp.postJsonWithRetry(url, key, json.toString()).use { response ->
                    val respBody = response.body?.string().orEmpty()
                    if (response.isSuccessful) {
                        Log.d("SocialInbox", "Device registered with dashboard OK")
                        runMain { callback?.invoke(true, "Connected — device should appear in the web dashboard.") }
                    } else {
                        Log.e("SocialInbox", "Device reg HTTP ${response.code}: ${respBody.take(400)}")
                        val friendly = formatDeviceSyncError(response.code, respBody)
                        runMain { callback?.invoke(false, friendly) }
                    }
                }
            } catch (e: Exception) {
                Log.e("SocialInbox", "Device reg error: ${e.message}", e)
                runMain { callback?.invoke(false, formatNetworkError(e)) }
            }
        }.start()
    }

    /**
     * Turns PostgREST JSON errors (e.g. PGRST205 missing table) into short instructions.
     */
    private fun formatDeviceSyncError(httpCode: Int, respBody: String): String {
        return try {
            val j = JSONObject(respBody)
            val message = j.optString("message", "")
            val code = j.optString("code", "")
            when {
                message.contains("public.devices", ignoreCase = true) ||
                    (code == "PGRST205" && message.contains("devices", ignoreCase = true)) ->
                    "Supabase has no devices table yet. On a computer: open your Supabase project → SQL → paste and run supabase/setup_complete.sql from this app’s repo, then reopen this screen."

                message.contains("public.orders", ignoreCase = true) ||
                    (code == "PGRST205" && message.contains("orders", ignoreCase = true)) ->
                    "Supabase has no orders table. Run supabase/setup_complete.sql (or fix_missing_orders.sql) in the SQL editor, then try again."

                else ->
                    "Dashboard sync failed ($httpCode). ${message.ifBlank { respBody.take(180) }}"
            }
        } catch (_: Exception) {
            "Dashboard sync failed ($httpCode). ${respBody.take(200)}"
        }
    }

    private fun formatNetworkError(e: Throwable): String {
        val chain = buildList {
            var c: Throwable? = e
            while (c != null) {
                add(c)
                c = c.cause
            }
        }
        val combined = chain.mapNotNull { it.message }.joinToString(" ")
        val hostHint = supabaseBaseUrl()
            .removePrefix("https://")
            .removePrefix("http://")
            .take(80)

        return when {
            chain.any { it is UnknownHostException } ||
                combined.contains("Unable to resolve host", ignoreCase = true) ||
                combined.contains("No address associated with hostname", ignoreCase = true) ->
                "Phone could not look up Supabase ($hostHint). Try: switch Wi‑Fi ↔ mobile data, turn off VPN, set Private DNS to Automatic (Android Settings → Network), or try another network."

            combined.contains("timeout", ignoreCase = true) ||
                combined.contains("timed out", ignoreCase = true) ->
                "Connection timed out. Check internet and try again."

            else -> e.message ?: "Network error"
        }
    }

    private fun runMain(block: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            block()
        } else {
            Handler(Looper.getMainLooper()).post(block)
        }
    }
}
