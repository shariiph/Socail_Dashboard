package com.aggregator.socialinbox

import android.content.Context
import android.os.Build
import android.provider.Settings
import java.util.Locale

/**
 * Builds a readable label for the dashboard (e.g. "Ahmed's Redmi · Xiaomi 21061119BI").
 * Uses the system "Device name" when set, plus manufacturer / brand / model.
 */
object DeviceIdentity {

    fun displayName(context: Context): String {
        val manufacturer = Build.MANUFACTURER
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
        val brand = Build.BRAND
            .replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.US) else it.toString() }
        val model = Build.MODEL.ifBlank { "Android" }

        val hardwareLine = when {
            brand.equals(manufacturer, ignoreCase = true) -> "$manufacturer $model"
            else -> "$manufacturer $brand $model"
        }.trim()

        val customName = readGlobalDeviceName(context)

        val label = if (!customName.isNullOrBlank() &&
            !customName.equals(model, ignoreCase = true) &&
            !customName.equals(hardwareLine, ignoreCase = true)
        ) {
            "$customName · $hardwareLine"
        } else {
            hardwareLine
        }

        return label.trim().take(120)
    }

    private fun readGlobalDeviceName(context: Context): String? {
        return try {
            Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)?.trim()
        } catch (_: Exception) {
            null
        }?.takeIf { it.isNotEmpty() }
    }
}
