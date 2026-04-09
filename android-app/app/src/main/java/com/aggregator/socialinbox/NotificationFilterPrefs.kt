package com.aggregator.socialinbox

import android.content.Context

/**
 * Blocklist of package names (comma or newline separated) — notifications from these apps are not synced.
 */
object NotificationFilterPrefs {

    private const val PREFS = "wallet_hub_notification_filters"
    private const val KEY_BLOCKED = "blocked_packages_csv"
    private const val KEY_REDACTION = "redact_sensitive_enabled"

    fun blockedPackagesCsvRaw(context: Context): String {
        return context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_BLOCKED, "") ?: ""
    }

    fun blockedPackages(context: Context): Set<String> {
        val raw = blockedPackagesCsvRaw(context)
        return raw.split(',', ';', '\n')
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .toSet()
    }

    fun setBlockedPackagesCsv(context: Context, csv: String) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_BLOCKED, csv)
            .apply()
    }

    fun isRedactionEnabled(context: Context): Boolean {
        return context.applicationContext
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_REDACTION, true)
    }

    fun setRedactionEnabled(context: Context, enabled: Boolean) {
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_REDACTION, enabled)
            .apply()
    }

    fun isPackageBlocked(context: Context, packageName: String): Boolean {
        val p = packageName.lowercase()
        return blockedPackages(context).any { blocked -> p == blocked || p.startsWith("$blocked.") }
    }
}
