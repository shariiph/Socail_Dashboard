package com.aggregator.socialinbox

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.Telephony
import androidx.core.content.ContextCompat
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Reads native SMS + [CallLog] and upserts into Supabase (`sms_messages`, `phone_calls`).
 * Requires [android.Manifest.permission.READ_SMS] and [android.Manifest.permission.READ_CALL_LOG].
 */
object SystemTelephonySync {

    private const val PREFS = "social_inbox_telephony"
    private const val KEY_MAX_SMS_ID = "max_android_sms_id"
    private const val KEY_MAX_CALL_ID = "max_android_call_id"

    private val http = OkHttpClient()

    /** SMS + call log sync needs these; [READ_CONTACTS] is optional (names). */
    fun hasTelephonyReadPermissions(context: Context): Boolean {
        val app = context.applicationContext
        return ContextCompat.checkSelfPermission(app, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(app, Manifest.permission.READ_CALL_LOG) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun utcIso(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(ms))
    }

    fun syncSmsAndCalls(context: Context): SyncResult {
        if (!SupabaseSync.isConfigured()) {
            return SyncResult(0, 0, "Supabase not configured", false)
        }
        val app = context.applicationContext
        val deviceId =
            android.provider.Settings.Secure.getString(app.contentResolver, android.provider.Settings.Secure.ANDROID_ID)
                ?: return SyncResult(0, 0, "No ANDROID_ID", false)

        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        var smsCount = 0
        var callCount = 0
        val errors = mutableListOf<String>()

        val maxSms = prefs.getLong(KEY_MAX_SMS_ID, 0L)
        val smsRows = readSmsSince(app, maxSms)
        smsRows.chunked(120).forEach { chunk ->
            val arr = JSONArray()
            var localMax = maxSms
            for (row in chunk) {
                localMax = maxOf(localMax, row.androidId)
                arr.put(row.toJson(deviceId, ::utcIso))
            }
            val err = postBulk(
                "${SupabaseSync.supabaseBaseUrl()}/rest/v1/sms_messages?on_conflict=sync_fingerprint",
                arr
            )
            if (err != null) errors.add("SMS: $err")
            else {
                smsCount += chunk.size
                prefs.edit().putLong(KEY_MAX_SMS_ID, localMax).apply()
            }
        }

        val maxCall = prefs.getLong(KEY_MAX_CALL_ID, 0L)
        val callRows = readCallsSince(app, maxCall)
        callRows.chunked(120).forEach { chunk ->
            val arr = JSONArray()
            var localMax = maxCall
            for (row in chunk) {
                localMax = maxOf(localMax, row.androidId)
                arr.put(row.toJson(deviceId, ::utcIso))
            }
            val err = postBulk(
                "${SupabaseSync.supabaseBaseUrl()}/rest/v1/phone_calls?on_conflict=sync_fingerprint",
                arr
            )
            if (err != null) errors.add("Calls: $err")
            else {
                callCount += chunk.size
                prefs.edit().putLong(KEY_MAX_CALL_ID, localMax).apply()
            }
        }

        val msg = when {
            errors.isEmpty() -> "Synced $smsCount SMS, $callCount calls."
            else -> errors.joinToString(" ")
        }
        Log.d("SocialInbox", msg)
        val ok = errors.isEmpty()
        return SyncResult(smsCount, callCount, msg, ok)
    }

    data class SyncResult(
        val smsUploaded: Int,
        val callsUploaded: Int,
        val message: String,
        val success: Boolean
    )

    private data class SmsRow(
        val androidId: Long,
        val threadId: String?,
        val address: String,
        val contactName: String?,
        val body: String,
        val smsBox: String,
        val readFlag: Boolean,
        val occurredAtMs: Long
    ) {
        fun toJson(deviceId: String, formatUtc: (Long) -> String): JSONObject {
            val fp = rowSyncFingerprint("sms", deviceId, androidId)
            return JSONObject().apply {
                put("sync_fingerprint", fp)
                put("device_id", deviceId)
                put("android_sms_id", androidId)
                put("thread_id", threadId ?: JSONObject.NULL)
                put("address", address)
                put("contact_name", contactName ?: JSONObject.NULL)
                put("body", body)
                put("sms_box", smsBox)
                put("read_flag", readFlag)
                put("occurred_at", formatUtc(occurredAtMs))
            }
        }
    }

    private data class CallRow(
        val androidId: Long,
        val number: String,
        val contactName: String?,
        val durationSec: Int,
        val callType: String,
        val occurredAtMs: Long
    ) {
        fun toJson(deviceId: String, formatUtc: (Long) -> String): JSONObject {
            val fp = rowSyncFingerprint("call", deviceId, androidId)
            return JSONObject().apply {
                put("sync_fingerprint", fp)
                put("device_id", deviceId)
                put("android_call_id", androidId)
                put("phone_number", number)
                put("contact_name", contactName ?: JSONObject.NULL)
                put("duration_seconds", durationSec)
                put("call_type", callType)
                put("occurred_at", formatUtc(occurredAtMs))
            }
        }
    }

    private fun readSmsSince(context: Context, afterId: Long): List<SmsRow> {
        val uri = Telephony.Sms.CONTENT_URI
        val projection = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.THREAD_ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.TYPE,
            Telephony.Sms.READ
        )
        val selection = "${Telephony.Sms._ID} > ?"
        val selArgs = arrayOf(afterId.toString())
        val sort = "${Telephony.Sms._ID} ASC"
        val out = mutableListOf<SmsRow>()
        val nameCache = mutableMapOf<String, String?>()
        try {
            context.contentResolver.query(uri, projection, selection, selArgs, sort)?.use { c ->
                while (c.moveToNext()) {
                    out.add(smsFromCursor(context, c, nameCache))
                }
            }
        } catch (e: SecurityException) {
            Log.e("SocialInbox", "SMS read denied: ${e.message}")
        }
        return out
    }

    private fun lookupContactName(
        context: Context,
        address: String,
        cache: MutableMap<String, String?>
    ): String? {
        val key = address.trim()
        if (key.isEmpty()) return null
        return cache.getOrPut(key) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) !=
                PackageManager.PERMISSION_GRANTED
            ) {
                return@getOrPut null
            }
            val uri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(address)
            )
            val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
            try {
                context.contentResolver.query(uri, projection, null, null, null)?.use { cur ->
                    if (cur.moveToFirst()) {
                        val idx = cur.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME)
                        if (idx >= 0) cur.getString(idx)?.takeIf { it.isNotBlank() } else null
                    } else null
                }
            } catch (e: SecurityException) {
                Log.w("SocialInbox", "Contact lookup denied: ${e.message}")
                null
            }
        }
    }

    private fun smsFromCursor(
        context: Context,
        c: Cursor,
        nameCache: MutableMap<String, String?>
    ): SmsRow {
        val id = c.getLong(c.getColumnIndexOrThrow(Telephony.Sms._ID))
        val tidIdx = c.getColumnIndex(Telephony.Sms.THREAD_ID)
        val threadId = if (tidIdx >= 0) c.getString(tidIdx) else null
        val address = c.getString(c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)) ?: ""
        val body = c.getString(c.getColumnIndexOrThrow(Telephony.Sms.BODY)) ?: ""
        val date = c.getLong(c.getColumnIndexOrThrow(Telephony.Sms.DATE))
        val type = c.getInt(c.getColumnIndexOrThrow(Telephony.Sms.TYPE))
        val readInt = c.getInt(c.getColumnIndexOrThrow(Telephony.Sms.READ))
        val box = when (type) {
            Telephony.Sms.MESSAGE_TYPE_INBOX -> "inbox"
            Telephony.Sms.MESSAGE_TYPE_SENT -> "sent"
            Telephony.Sms.MESSAGE_TYPE_DRAFT -> "draft"
            Telephony.Sms.MESSAGE_TYPE_OUTBOX -> "outbox"
            Telephony.Sms.MESSAGE_TYPE_FAILED -> "failed"
            Telephony.Sms.MESSAGE_TYPE_QUEUED -> "queued"
            else -> "other"
        }
        val contactName = lookupContactName(context, address, nameCache)
        return SmsRow(
            androidId = id,
            threadId = threadId,
            address = address,
            contactName = contactName,
            body = body,
            smsBox = box,
            readFlag = readInt != 0,
            occurredAtMs = date
        )
    }

    private fun readCallsSince(context: Context, afterId: Long): List<CallRow> {
        val projection = arrayOf(
            CallLog.Calls._ID,
            CallLog.Calls.NUMBER,
            CallLog.Calls.CACHED_NAME,
            CallLog.Calls.DURATION,
            CallLog.Calls.TYPE,
            CallLog.Calls.DATE
        )
        val selection = "${CallLog.Calls._ID} > ?"
        val selArgs = arrayOf(afterId.toString())
        val sort = "${CallLog.Calls._ID} ASC"
        val out = mutableListOf<CallRow>()
        try {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                selection,
                selArgs,
                sort
            )?.use { c ->
                while (c.moveToNext()) {
                    out.add(callFromCursor(c))
                }
            }
        } catch (e: SecurityException) {
            Log.e("SocialInbox", "Call log read denied: ${e.message}")
        }
        return out
    }

    private fun callFromCursor(c: Cursor): CallRow {
        val id = c.getLong(c.getColumnIndexOrThrow(CallLog.Calls._ID))
        val numIdx = c.getColumnIndex(CallLog.Calls.NUMBER)
        val number = if (numIdx >= 0) (c.getString(numIdx) ?: "") else ""
        val nameIdx = c.getColumnIndex(CallLog.Calls.CACHED_NAME)
        val name = if (nameIdx >= 0) c.getString(nameIdx) else null
        val dur = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.DURATION))
        val type = c.getInt(c.getColumnIndexOrThrow(CallLog.Calls.TYPE))
        val date = c.getLong(c.getColumnIndexOrThrow(CallLog.Calls.DATE))
        val typeStr = when (type) {
            CallLog.Calls.INCOMING_TYPE -> "incoming"
            CallLog.Calls.OUTGOING_TYPE -> "outgoing"
            CallLog.Calls.MISSED_TYPE -> "missed"
            CallLog.Calls.VOICEMAIL_TYPE -> "voicemail"
            CallLog.Calls.REJECTED_TYPE -> "rejected"
            CallLog.Calls.BLOCKED_TYPE -> "blocked"
            else -> "unknown"
        }
        return CallRow(
            androidId = id,
            number = number.ifBlank { "(unknown)" },
            contactName = name?.takeIf { it.isNotBlank() },
            durationSec = dur,
            callType = typeStr,
            occurredAtMs = date
        )
    }

    private fun postBulk(url: String, body: JSONArray): String? {
        if (body.length() == 0) return null
        val key = SupabaseSync.apiKey()
        val reqBody = body.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url(url)
            .post(reqBody)
            .addHeader("apikey", key)
            .addHeader("Authorization", "Bearer $key")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates")
            .build()
        return try {
            http.newCall(request).execute().use { response ->
                if (response.isSuccessful) null
                else response.body?.string()?.take(500) ?: "HTTP ${response.code}"
            }
        } catch (e: Exception) {
            e.message
        }
    }

}

private fun rowSyncFingerprint(kind: String, deviceId: String, rowId: Long): String {
    val raw = "$kind|$deviceId|$rowId"
    val digest = MessageDigest.getInstance("SHA-256")
    val bytes = digest.digest(raw.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
}
