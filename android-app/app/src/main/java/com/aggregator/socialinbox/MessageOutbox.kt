package com.aggregator.socialinbox

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lightweight local outbox for failed message sync attempts.
 * Keeps implementation simple and dependency-free.
 */
object MessageOutbox {
    private const val PREFS = "social_inbox_outbox"
    private const val KEY_QUEUE = "pending_messages"
    private const val MAX_QUEUE_SIZE = 200

    @Synchronized
    fun enqueue(context: Context, payload: MessagePayload) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = loadArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]")
        if (arr.length() >= MAX_QUEUE_SIZE) {
            val trimmed = JSONArray()
            for (i in 1 until arr.length()) trimmed.put(arr.getJSONObject(i))
            trimmed.put(payload.toJson())
            prefs.edit().putString(KEY_QUEUE, trimmed.toString()).apply()
        } else {
            arr.put(payload.toJson())
            prefs.edit().putString(KEY_QUEUE, arr.toString()).apply()
        }
    }

    @Synchronized
    fun drainTo(context: Context, uploadFn: (MessagePayload) -> Boolean) {
        val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = loadArray(prefs.getString(KEY_QUEUE, "[]") ?: "[]")
        if (arr.length() == 0) return

        val remaining = JSONArray()
        for (i in 0 until arr.length()) {
            val payload = arr.getJSONObject(i).toPayload()
            if (payload == null) continue
            val ok = runCatching { uploadFn(payload) }.getOrDefault(false)
            if (!ok) remaining.put(arr.getJSONObject(i))
        }
        prefs.edit().putString(KEY_QUEUE, remaining.toString()).apply()
        Log.d("SocialInbox.Outbox", "drain complete: uploaded=${arr.length() - remaining.length()} remaining=${remaining.length()}")
    }

    private fun loadArray(raw: String): JSONArray = runCatching { JSONArray(raw) }.getOrDefault(JSONArray())

    private fun MessagePayload.toJson(): JSONObject = JSONObject().apply {
        put("senderName", senderName)
        put("messageText", messageText)
        put("appSource", appSource)
        put("deviceId", deviceId)
        put("notificationKey", notificationKey ?: JSONObject.NULL)
        put("conversationId", conversationId)
        put("fingerprint", fingerprint)
        put("orderRef", orderRef ?: JSONObject.NULL)
        put("orderStatusHint", orderStatusHint ?: JSONObject.NULL)
        put("amount", amount ?: JSONObject.NULL)
        put("currency", currency ?: JSONObject.NULL)
        put("receivedAt", receivedAt)
    }

    private fun JSONObject.toPayload(): MessagePayload? = runCatching {
        MessagePayload(
            senderName = getString("senderName"),
            messageText = getString("messageText"),
            appSource = getString("appSource"),
            deviceId = getString("deviceId"),
            notificationKey = optString("notificationKey").takeIf { it.isNotBlank() },
            conversationId = getString("conversationId"),
            fingerprint = getString("fingerprint"),
            orderRef = optString("orderRef").takeIf { it.isNotBlank() },
            orderStatusHint = optString("orderStatusHint").takeIf { it.isNotBlank() },
            amount = if (isNull("amount")) null else getDouble("amount"),
            currency = optString("currency").takeIf { it.isNotBlank() },
            receivedAt = getLong("receivedAt")
        )
    }.getOrNull()
}
