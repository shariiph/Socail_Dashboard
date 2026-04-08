package com.aggregator.socialinbox

import android.app.Notification
import android.os.Build
import android.service.notification.NotificationListenerService
import androidx.core.app.NotificationCompat
import android.service.notification.StatusBarNotification
import android.util.Log
import android.provider.Settings
import com.aggregator.socialinbox.BuildConfig
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.*
import java.security.MessageDigest
import java.util.concurrent.Executors

/**
 * Syncs **social and messenger** notifications to Supabase (`messages` table): WhatsApp, Telegram,
 * Facebook / Messenger / Marketplace, Snapchat, Viber, Instagram DM, etc. This is separate from
 * native SMS ([SystemTelephonySync]). Reliability depends on each app posting a usable notification
 * preview — we merge MessagingStyle, big text, text lines, and subtext when plain [EXTRA_TEXT] is empty.
 */
class InboxNotificationService : NotificationListenerService() {

    private val client = OkHttpClient()
    /** Serializes notification uploads; ensures device row exists before each message (FK to devices). */
    private val notificationSyncExecutor = Executors.newSingleThreadExecutor()
    private val SUPABASE_URL = BuildConfig.SUPABASE_URL.trim().trimEnd('/')
    private val SUPABASE_KEY = if (BuildConfig.SUPABASE_SERVICE_ROLE_KEY.isNotBlank()) {
        BuildConfig.SUPABASE_SERVICE_ROLE_KEY
    } else {
        BuildConfig.SUPABASE_ANON_KEY
    }

    private var lastDeviceHeartbeatMs: Long = 0
    private val DEVICE_HEARTBEAT_INTERVAL_MS: Long = 60 * 1000 // 1 minute (align with DashboardHeartbeatService)

    // Extract order-related data from notification text.
    private val orderRefRegexes: List<Regex> = listOf(
        Regex("""(?i)\b(?:order|ord(?:er)?|reference|ref|receipt|txn|transaction)\b[\s:#-]*([A-Za-z0-9-]{4,})"""),
        Regex("""(?i)\b(?:ref|receipt|txn|transaction)[\s:#-]+([A-Za-z0-9-]{4,})"""),
        // Fallback: patterns like AB-1234 or AB12345 (avoid too short matches).
        Regex("""\b[A-Z]{2,5}-?\d{3,}\b""")
    )

    private val amountRegex = Regex(
        """(?i)\b(?:total|amount|paid|payment)\b[^0-9]{0,10}([€£$]|USD|EUR|GBP|INR|AED|SAR|NGN|KES)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+(?:[.,][0-9]{1,2})?)\b"""
    )

    private val statusRegexes: List<Pair<Regex, String>> = listOf(
        Regex("""(?i)\b(paid|payment received|successful|success|completed|confirmed)\b""") to "paid",
        Regex("""(?i)\b(refunded|refund)\b""") to "refunded",
        Regex("""(?i)\b(shipped|delivered)\b""") to "delivered",
        Regex("""(?i)\b(failed|declined|error|unsuccessful|rejected)\b""") to "failed",
        Regex("""(?i)\b(canceled|cancelled|void)\b""") to "cancelled",
        Regex("""(?i)\b(pending|processing|in progress)\b""") to "processing"
    )

    override fun onCreate() {
        super.onCreate()
        Log.d("SocialInbox", "Service Started")
        maybeRegisterDevice(force = true)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val packageName = sbn.packageName
        val notification = sbn.notification
        val extras = notification.extras

        val title = resolveNotificationTitle(extras)
        val text = extractMessageText(notification).trim()

        // Filter out system apps and empty notifications
        val ignoreList = listOf("android", "com.android.systemui", "com.android.settings")

        val usableText = when {
            text.isNotEmpty() -> text
            title.isNotBlank() && title != "Unknown Sender" && isLikelyMessengerPackage(packageName) ->
                // Some OEMs/apps post only a title line (e.g. sender) with no body in extras we read.
                "[No preview — Android did not expose message text. Open the app on your phone to read.]"
            else -> ""
        }

        if (usableText.isNotEmpty() && packageName !in ignoreList) {
            val combined = "$title\n$usableText"
            val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "Unknown_Device"

            val notificationKey = try {
                sbn.key
            } catch (e: Exception) {
                null
            }

            val fingerprint = sha256(
                listOf(
                    deviceId,
                    packageName,
                    title.trim(),
                    usableText.trim(),
                    notificationKey ?: "",
                    sbn.postTime.toString()
                ).joinToString("|")
            )

            val orderRef = extractOrderRef(combined)
            val (amount, currency) = extractAmount(combined)
            val statusHint = extractStatusHint(combined)

            syncMessage(
                senderName = title,
                messageText = usableText,
                appSource = packageName,
                deviceId = deviceId,
                notificationKey = notificationKey,
                messageFingerprint = fingerprint,
                orderRef = orderRef,
                orderStatusHint = statusHint,
                amount = amount,
                currency = currency,
                receivedAt = sbn.postTime
            )
        }
    }

    private fun maybeRegisterDevice(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && (now - lastDeviceHeartbeatMs) < DEVICE_HEARTBEAT_INTERVAL_MS) return
        lastDeviceHeartbeatMs = now

        SupabaseSync.registerDeviceWithDashboard(applicationContext, null)
    }

    private fun syncMessage(
        senderName: String,
        messageText: String,
        appSource: String,
        deviceId: String,
        notificationKey: String?,
        messageFingerprint: String,
        orderRef: String?,
        orderStatusHint: String?,
        amount: Double?,
        currency: String?,
        receivedAt: Long
    ) {
        if (SUPABASE_URL.isBlank() || SUPABASE_KEY.isBlank()) {
            Log.e("SocialInbox", "Supabase config missing (SUPABASE_URL and key).")
            return
        }

        notificationSyncExecutor.execute {
            if (!SupabaseSync.ensureDeviceRegistered(applicationContext)) {
                Log.e(
                    "SocialInbox",
                    "Message not sent: could not register device in Supabase (messages require a devices row). Check network and table setup."
                )
                return@execute
            }

            val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
            sdf.timeZone = TimeZone.getTimeZone("UTC")
            val receivedIso = sdf.format(Date(receivedAt))

            val json = JSONObject().apply {
                put("sender_name", senderName)
                put("message_title", senderName)
                put("message_text", messageText)
                put("app_source", appSource)
                put("device_id", deviceId)
                put("notification_key", notificationKey ?: JSONObject.NULL)
                put("message_fingerprint", messageFingerprint)
                put("received_at", receivedIso)
                put("order_ref", orderRef ?: JSONObject.NULL)
                put("order_status_hint", orderStatusHint ?: JSONObject.NULL)
                put("amount", amount ?: JSONObject.NULL)
                put("currency", currency ?: JSONObject.NULL)
            }

            val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            val request = Request.Builder()
                .url("$SUPABASE_URL/rest/v1/messages?on_conflict=message_fingerprint")
                .post(body)
                .addHeader("apikey", SUPABASE_KEY)
                .addHeader("Authorization", "Bearer $SUPABASE_KEY")
                .addHeader("Content-Type", "application/json")
                .addHeader("Prefer", "resolution=merge-duplicates")
                .build()

            try {
                client.newCall(request).execute().use { response ->
                    if (!response.isSuccessful) {
                        val errBody = response.body?.string()?.take(800) ?: ""
                        Log.e("SocialInbox", "Message sync HTTP ${response.code}: $errBody")
                        return@execute
                    }
                    if (!orderRef.isNullOrBlank()) {
                        upsertOrderSync(
                            orderRef = orderRef,
                            statusHint = orderStatusHint,
                            amount = amount,
                            currency = currency,
                            lastMessageFingerprint = messageFingerprint,
                            lastMessageText = messageText,
                            receivedAtIso = receivedIso
                        )
                    }
                }
            } catch (e: IOException) {
                Log.e("SocialInbox", "Message sync failed: ${e.message}", e)
            } catch (e: Exception) {
                Log.e("SocialInbox", "Message sync failed: ${e.message}", e)
            }

            maybeRegisterDevice(force = false)
        }
    }

    private fun upsertOrderSync(
        orderRef: String?,
        statusHint: String?,
        amount: Double?,
        currency: String?,
        lastMessageFingerprint: String,
        lastMessageText: String,
        receivedAtIso: String
    ) {
        if (orderRef.isNullOrBlank()) return
        val safeRef = orderRef.trim()

        val json = JSONObject().apply {
            put("order_ref", safeRef)
            if (!statusHint.isNullOrBlank()) put("status", statusHint)
            if (amount != null) put("amount", amount)
            if (!currency.isNullOrBlank()) put("currency", currency)
            put("last_message_fingerprint", lastMessageFingerprint)
            put("last_message_text", lastMessageText)
            put("last_message_at", receivedAtIso)
        }

        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("$SUPABASE_URL/rest/v1/orders?on_conflict=order_ref")
            .post(body)
            .addHeader("apikey", SUPABASE_KEY)
            .addHeader("Authorization", "Bearer $SUPABASE_KEY")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates")
            .build()

        try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) {
                    val err = response.body?.string()?.take(500) ?: ""
                    Log.e("SocialInbox", "Order upsert HTTP ${response.code}: $err")
                }
            }
        } catch (e: Exception) {
            Log.e("SocialInbox", "Order upsert failed: ${e.message}", e)
        }
    }

    private fun extractOrderRef(text: String): String? {
        val haystack = text.replace('\n', ' ').trim()
        for (re in orderRefRegexes) {
            val match = re.find(haystack) ?: continue
            val group = if (match.groups.size > 1) match.groups[1]?.value else null
            if (!group.isNullOrBlank()) return group.trim()
            // Fallback patterns without capture group.
            if (match.value.length >= 4) return match.value.trim()
        }
        return null
    }

    private fun extractStatusHint(text: String): String? {
        for ((re, status) in statusRegexes) {
            if (re.find(text) != null) return status
        }
        return null
    }

    private fun extractAmount(text: String): Pair<Double?, String?> {
        val match = amountRegex.find(text) ?: return Pair(null, null)
        val rawCurrency = match.groupValues.getOrNull(1)?.trim()
        val rawNumber = match.groupValues.getOrNull(2)?.trim()
        if (rawNumber.isNullOrBlank()) return Pair(null, null)

        val normalized = rawNumber
            .replace(",", "")
            .replace(" ", "")
            .replace("€", "")
            .replace("£", "")
        // Handle European decimals like "1.234,56"
        val decimalIsComma = normalized.count { it == ',' } > 0
        val numberValue = try {
            if (decimalIsComma) {
                normalized.replace(".", "").replace(",", ".").toDouble()
            } else {
                normalized.replace(",", "").toDouble()
            }
        } catch (e: Exception) {
            null
        }

        val currency = when ((rawCurrency ?: "").uppercase(Locale.US)) {
            "$", "USD" -> "USD"
            "€", "EUR" -> "EUR"
            "£", "GBP" -> "GBP"
            "INR" -> "INR"
            "AED" -> "AED"
            "SAR" -> "SAR"
            "NGN" -> "NGN"
            "KES" -> "KES"
            else -> null
        }

        return Pair(numberValue, currency)
    }

    private fun sha256(input: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val bytes = digest.digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }

    /** Full conversation text when the app uses MessagingStyle (API 28+). */
    private fun resolveNotificationTitle(extras: android.os.Bundle): String {
        return extras.getString(Notification.EXTRA_CONVERSATION_TITLE)?.trim()?.takeIf { it.isNotEmpty() }
            ?: extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            ?: "Unknown Sender"
    }

    /**
     * Pulls the best available message body. Chat apps often use MessagingStyle, [EXTRA_BIG_TEXT],
     * [EXTRA_TEXT_LINES] (InboxStyle / summaries), or put the preview only in [EXTRA_SUB_TEXT].
     */
    private fun extractMessageText(notification: Notification): String {
        extractMessagingStyleText(notification)?.let { return it }

        val extras = notification.extras ?: return ""

        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.filterNotNull()?.map { it.toString().trim() }
            ?.filter { it.isNotEmpty() }
            ?.takeIf { it.isNotEmpty() }
            ?.joinToString("\n")
            ?.let { return it }

        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it }

        extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it }

        extras.getCharSequence(Notification.EXTRA_SUB_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it }

        extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it }

        extras.getCharSequence(Notification.EXTRA_INFO_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            ?.let { return it }

        return ""
    }

    /**
     * Known messenger / social package prefixes (not exhaustive). Used only to allow a minimal
     * placeholder row when the OS exposes a title but no extractable preview text.
     */
    private fun isLikelyMessengerPackage(packageName: String): Boolean {
        val p = packageName.lowercase(Locale.US)
        return listOf(
            "whatsapp", "telegram", "facebook", "instagram", "snapchat", "viber", "signal",
            "messenger", "twitter", "tiktok", "linkedin", "discord", "slack", "marketplace",
            "wechat", "line", "imessage", "org.thoughtcrime", "beeper"
        ).any { p.contains(it) }
    }

    private fun extractMessagingStyleText(notification: Notification): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return null
        val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
            ?: return null
        val messages = style.messages ?: return null
        if (messages.isEmpty()) return null
        return messages.joinToString("\n") { msg: NotificationCompat.MessagingStyle.Message ->
            msg.text?.toString().orEmpty()
        }.trim().takeIf { body -> body.isNotEmpty() }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        DashboardHeartbeatService.start(this)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        DashboardHeartbeatService.stop(this)
    }
}
