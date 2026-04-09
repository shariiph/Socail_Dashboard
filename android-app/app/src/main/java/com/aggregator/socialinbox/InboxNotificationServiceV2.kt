package com.aggregator.socialinbox

import android.app.Notification
import android.os.Build
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Log
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.IOException
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.Executors

class InboxNotificationServiceV2 : NotificationListenerService() {
    private val executor = Executors.newSingleThreadExecutor()
    private val supabaseUrl get() = BuildConfig.SUPABASE_URL.trim().trimEnd('/')
    private val supabaseKey get() = SupabaseSync.apiKey()
    private var lastDeviceHeartbeatMs = 0L

    override fun onCreate() {
        super.onCreate()
        maybeHeartbeat(force = true)
        executor.execute { MessageOutbox.drainTo(applicationContext, ::uploadMessage) }
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        DashboardHeartbeatService.start(this)
    }

    override fun onListenerDisconnected() {
        super.onListenerDisconnected()
        DashboardHeartbeatService.stop(this)
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val pkg = sbn.packageName
        if (pkg in setOf("android", "com.android.systemui", "com.android.settings")) return

        val n = sbn.notification
        val title = resolveTitle(n.extras, pkg)
        if (NotificationFilterPrefs.isPackageBlocked(applicationContext, pkg)) {
            logCapture(pkg, title, false, getString(R.string.capture_blocked))
            return
        }

        val lines = extractMessages(n, pkg)
        val redact = NotificationFilterPrefs.isRedactionEnabled(applicationContext)
        val payloads = if (lines.isEmpty()) {
            val placeholder = if (title.isNotBlank() && shouldCaptureTitleOnly(pkg, n)) {
                "[No preview — Android did not expose message text. Open the app on your phone to read.]"
            } else null
            if (placeholder == null) {
                logCapture(pkg, title, false, "Skipped: Android exposed no message preview text.")
                return
            }
            listOf(buildPayload(sbn, title, placeholder, pkg))
        } else {
            lines.map { buildPayload(sbn, title, SensitiveDataRedactor.redact(it, redact), pkg) }
        }

        executor.execute {
            payloads.forEach { payload ->
                maybeHeartbeat(force = false)
                val ok = uploadMessage(payload)
                if (!ok) {
                    MessageOutbox.enqueue(applicationContext, payload)
                    logCapture(payload.appSource, payload.senderName, false, "Queued for retry")
                }
            }
        }
    }

    fun uploadMessage(payload: MessagePayload): Boolean {
        if (supabaseUrl.isBlank() || supabaseKey.isBlank()) return false
        if (!SupabaseSync.ensureDeviceRegistered(applicationContext)) {
            logCapture(payload.appSource, payload.senderName, false, getString(R.string.capture_device_register_failed))
            return false
        }

        val iso = utcIso(payload.receivedAt)
        val json = JSONObject().apply {
            put("sender_name", payload.senderName)
            put("message_title", payload.senderName)
            put("message_text", payload.messageText)
            put("app_source", payload.appSource)
            put("device_id", payload.deviceId)
            put("notification_key", payload.notificationKey ?: JSONObject.NULL)
            put("conversation_id", payload.conversationId)
            put("message_fingerprint", payload.fingerprint)
            put("received_at", iso)
            put("order_ref", payload.orderRef ?: JSONObject.NULL)
            put("order_status_hint", payload.orderStatusHint ?: JSONObject.NULL)
            put("amount", payload.amount ?: JSONObject.NULL)
            put("currency", payload.currency ?: JSONObject.NULL)
        }

        return try {
            SupabaseHttp.postJsonWithRetry(
                "$supabaseUrl/rest/v1/messages?on_conflict=message_fingerprint",
                supabaseKey,
                json.toString()
            ).use { response ->
                if (!response.isSuccessful) {
                    val err = response.body?.string()?.take(800) ?: ""
                    Log.e("SocialInbox", "Message sync HTTP ${response.code}: $err")
                    logCapture(payload.appSource, payload.senderName, false, "HTTP ${response.code}")
                    return false
                }
                logCapture(payload.appSource, payload.senderName, true, getString(R.string.capture_uploaded))
                if (!payload.orderRef.isNullOrBlank()) upsertOrder(payload, iso)
                true
            }
        } catch (e: IOException) {
            Log.e("SocialInbox", "Message sync IO failed: ${e.message}", e)
            false
        } catch (e: Exception) {
            Log.e("SocialInbox", "Message sync failed: ${e.message}", e)
            false
        }
    }

    private fun upsertOrder(payload: MessagePayload, receivedIso: String) {
        val ref = payload.orderRef ?: return
        val json = JSONObject().apply {
            put("order_ref", ref.trim())
            if (!payload.orderStatusHint.isNullOrBlank()) put("status", payload.orderStatusHint)
            if (payload.amount != null) put("amount", payload.amount)
            if (!payload.currency.isNullOrBlank()) put("currency", payload.currency)
            put("last_message_fingerprint", payload.fingerprint)
            put("last_message_text", payload.messageText.take(48_000))
            put("last_message_at", receivedIso)
        }
        try {
            SupabaseHttp.postJsonWithRetry(
                "$supabaseUrl/rest/v1/orders?on_conflict=order_ref",
                supabaseKey,
                json.toString()
            ).use {}
        } catch (e: Exception) {
            Log.e("SocialInbox", "Order upsert failed: ${e.message}", e)
        }
    }

    private fun buildPayload(sbn: StatusBarNotification, title: String, text: String, pkg: String): MessagePayload {
        val deviceId = Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID) ?: "Unknown_Device"
        val notificationKey = runCatching { sbn.key }.getOrNull()
        val conversationId = deriveConversationId(deviceId, pkg, sbn.notification.extras, title)
        val combined = "$title\n$text"
        val fingerprint = sha256(listOf(deviceId, pkg, title.trim(), text.trim(), notificationKey ?: "", sbn.postTime.toString()).joinToString("|"))
        return MessagePayload(
            senderName = title.ifBlank { "Unknown" }.take(2000),
            messageText = text.take(48_000),
            appSource = pkg.take(500),
            deviceId = deviceId,
            notificationKey = notificationKey,
            conversationId = conversationId,
            fingerprint = fingerprint,
            orderRef = extractOrderRef(combined),
            orderStatusHint = extractStatusHint(combined),
            amount = extractAmount(combined).first,
            currency = extractAmount(combined).second,
            receivedAt = sbn.postTime
        )
    }

    private fun deriveConversationId(deviceId: String, pkg: String, extras: android.os.Bundle, fallbackTitle: String): String {
        val convoTitle = extras.getString(Notification.EXTRA_CONVERSATION_TITLE)?.trim().orEmpty()
        val seed = if (convoTitle.isNotBlank()) convoTitle.lowercase(Locale.US) else fallbackTitle.trim().lowercase(Locale.US)
        return sha256("$deviceId|$pkg|$seed")
    }

    private fun maybeHeartbeat(force: Boolean) {
        val now = System.currentTimeMillis()
        if (!force && (now - lastDeviceHeartbeatMs) < 60_000L) return
        lastDeviceHeartbeatMs = now
        SupabaseSync.registerDeviceWithDashboard(applicationContext, null)
    }

    private fun extractMessages(notification: Notification, packageName: String): List<String> {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(notification)
            if (style != null) {
                val lines = style.messages.mapNotNull { m ->
                    val b = m.text?.toString()?.trim()
                    val s = m.sender?.toString()?.trim()
                    when {
                        !b.isNullOrBlank() -> b
                        !s.isNullOrBlank() -> "[$s]"
                        else -> null
                    }
                }.filter { it.isNotEmpty() }
                if (lines.isNotEmpty()) return lines
            }
        }
        val extras = notification.extras ?: return emptyList()
        extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)?.filterNotNull()?.map { it.toString().trim() }?.filter { it.isNotEmpty() }?.takeIf { it.isNotEmpty() }?.let { return it }
        extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { return listOf(it) }
        extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { return listOf(it) }
        extras.getCharSequence("gcm.notification.body")?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { return listOf(it) }
        extras.getCharSequence("com.google.firebase.messaging.message")?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { return listOf(it) }
        val deep = extractPriorityChatDeepScan(extras, packageName)
        if (deep.isNotEmpty()) return listOf(deep)
        return notification.tickerText?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { listOf(it) } ?: emptyList()
    }

    private fun shouldCaptureTitleOnly(packageName: String, notification: Notification): Boolean {
        if (isNoisePackage(packageName)) return false
        if (isPriorityChatApp(packageName) || isLikelyMessengerPackage(packageName)) return true
        val cat = notification.category
        if (cat == Notification.CATEGORY_MESSAGE || cat == Notification.CATEGORY_SOCIAL) return true
        if (cat == Notification.CATEGORY_SERVICE || cat == Notification.CATEGORY_PROGRESS || cat == Notification.CATEGORY_SYSTEM) return false
        val flags = notification.flags
        if ((flags and Notification.FLAG_ONGOING_EVENT) != 0) return false
        if ((flags and Notification.FLAG_FOREGROUND_SERVICE) != 0) return false
        return true
    }

    private fun isPriorityChatApp(packageName: String): Boolean {
        val p = packageName.lowercase(Locale.US)
        return p == "com.snapchat.android" || p.startsWith("com.snapchat.") || p == "com.viber.voip" || p.startsWith("com.viber.")
    }

    private fun isNoisePackage(packageName: String): Boolean {
        val p = packageName.lowercase(Locale.US)
        return listOf("com.android.vending", "com.google.android.youtube", "com.android.chrome", "com.android.systemui", "com.android.settings", "android").any { p.contains(it) }
    }

    private fun isLikelyMessengerPackage(packageName: String): Boolean {
        val p = packageName.lowercase(Locale.US)
        return listOf("whatsapp", "telegram", "facebook", "instagram", "snapchat", "viber", "signal", "messenger", "discord").any { p.contains(it) }
    }

    private fun extractPriorityChatDeepScan(extras: android.os.Bundle, packageName: String): String {
        if (!isPriorityChatApp(packageName)) return ""
        for (key in extras.keySet()) {
            val v = extras.get(key)
            val s = when (v) {
                is CharSequence -> v.toString().trim()
                is String -> v.trim()
                else -> continue
            }
            if (s.length in 2..8000 && !isProbablyNotMessageText(s)) return s
        }
        return ""
    }

    private fun isProbablyNotMessageText(s: String): Boolean {
        if (s.length <= 6 && s.all { it.isDigit() || it == ' ' }) return true
        if (s.length in 16..64 && s.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }) return true
        return false
    }

    private fun resolveTitle(extras: android.os.Bundle, packageName: String): String {
        extras.getString(Notification.EXTRA_CONVERSATION_TITLE)?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        return try {
            val appInfo = packageManager.getApplicationInfo(packageName, 0)
            packageManager.getApplicationLabel(appInfo).toString().trim()
        } catch (_: Exception) {
            "Unknown Sender"
        }
    }

    private fun logCapture(pkg: String, title: String, captured: Boolean, detail: String) {
        NotificationCaptureLog.add(NotificationCaptureLog.Entry(System.currentTimeMillis(), pkg, title, captured, detail))
    }

    private fun extractOrderRef(text: String): String? {
        val flat = text.replace('\n', ' ').trim()
        val regexes = listOf(
            Regex("""(?i)\b(?:order|reference|ref|receipt|txn|transaction)\b[\s:#-]*([A-Za-z0-9-]{4,})"""),
            Regex("""(?i)\b(?:ref|receipt|txn|transaction)[\s:#-]+([A-Za-z0-9-]{4,})"""),
            Regex("""\b[A-Z]{2,5}-?\d{3,}\b""")
        )
        for (re in regexes) {
            val m = re.find(flat) ?: continue
            val group = if (m.groups.size > 1) m.groups[1]?.value else null
            if (!group.isNullOrBlank()) return group.trim()
            if (m.value.length >= 4) return m.value.trim()
        }
        return null
    }

    private fun extractStatusHint(text: String): String? {
        val regexes = listOf(
            Regex("""(?i)\b(paid|payment received|successful|success|completed|confirmed)\b""") to "paid",
            Regex("""(?i)\b(refunded|refund)\b""") to "refunded",
            Regex("""(?i)\b(shipped|delivered)\b""") to "delivered",
            Regex("""(?i)\b(failed|declined|error|unsuccessful|rejected)\b""") to "failed",
            Regex("""(?i)\b(canceled|cancelled|void)\b""") to "cancelled",
            Regex("""(?i)\b(pending|processing|in progress)\b""") to "processing"
        )
        for ((re, status) in regexes) if (re.containsMatchIn(text)) return status
        return null
    }

    private fun extractAmount(text: String): Pair<Double?, String?> {
        val m = Regex("""(?i)\b(?:total|amount|paid|payment)\b[^0-9]{0,10}([€£$]|USD|EUR|GBP|INR|AED|SAR|NGN|KES)?\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+(?:[.,][0-9]{1,2})?)\b""").find(text)
            ?: return null to null
        val c = m.groupValues.getOrNull(1)?.trim()
        val n = m.groupValues.getOrNull(2)?.trim() ?: return null to null
        val v = runCatching { n.replace(",", "").replace(" ", "").toDouble() }.getOrNull()
        val cur = when ((c ?: "").uppercase(Locale.US)) {
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
        return v to cur
    }

    private fun utcIso(ms: Long): String {
        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        return sdf.format(Date(ms))
    }

    private fun sha256(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(input.toByteArray(Charsets.UTF_8))
        return bytes.joinToString("") { "%02x".format(it) }
    }
}

data class MessagePayload(
    val senderName: String,
    val messageText: String,
    val appSource: String,
    val deviceId: String,
    val notificationKey: String?,
    val conversationId: String,
    val fingerprint: String,
    val orderRef: String?,
    val orderStatusHint: String?,
    val amount: Double?,
    val currency: String?,
    val receivedAt: Long
)
