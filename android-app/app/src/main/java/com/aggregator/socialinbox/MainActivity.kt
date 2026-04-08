package com.aggregator.socialinbox

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.app.NotificationManagerCompat

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var statusHintText: TextView
    private lateinit var syncStatusText: TextView
    private lateinit var grantButton: Button
    private lateinit var phoneSyncButton: Button
    private lateinit var phoneSyncStatusText: TextView
    private lateinit var batteryStatusText: TextView
    private lateinit var batteryOptimizeButton: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        statusText = findViewById(R.id.statusText)
        statusHintText = findViewById(R.id.statusHintText)
        syncStatusText = findViewById(R.id.syncStatusText)
        grantButton = findViewById(R.id.grantButton)
        phoneSyncButton = findViewById(R.id.phoneSyncButton)
        phoneSyncStatusText = findViewById(R.id.phoneSyncStatusText)
        batteryStatusText = findViewById(R.id.batteryStatusText)
        batteryOptimizeButton = findViewById(R.id.batteryOptimizeButton)

        grantButton.setOnClickListener {
            startActivity(android.content.Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS"))
        }

        phoneSyncButton.setOnClickListener {
            requestPhonePermissionsAndSync()
        }

        batteryOptimizeButton.setOnClickListener {
            BatteryOptimizationHelper.openRequestIgnoreBatteryOptimizations(this)
        }

        refreshStatus()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    private fun isNotificationServiceEnabled(): Boolean {
        val enabledPackages = NotificationManagerCompat.getEnabledListenerPackages(this)
        return enabledPackages.contains(packageName)
    }

    private fun hasPhonePermissions(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED

    private fun requestPhonePermissionsAndSync() {
        if (hasPhonePermissions()) {
            runPhoneSync()
            return
        }
        ActivityCompat.requestPermissions(
            this,
            arrayOf(
                Manifest.permission.READ_SMS,
                Manifest.permission.READ_CALL_LOG,
                Manifest.permission.READ_CONTACTS
            ),
            REQ_PHONE_PERMS
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != REQ_PHONE_PERMS) return
        val granted = permissions.zip(grantResults.toList()).toMap()
        val smsOk = granted[Manifest.permission.READ_SMS] == PackageManager.PERMISSION_GRANTED
        val callOk = granted[Manifest.permission.READ_CALL_LOG] == PackageManager.PERMISSION_GRANTED
        if (smsOk && callOk) {
            runPhoneSync()
        } else {
            phoneSyncStatusText.visibility = View.VISIBLE
            phoneSyncStatusText.setTextColor(Color.parseColor("#FCA5A5"))
            phoneSyncStatusText.text = getString(R.string.phone_sync_denied)
        }
    }

    private fun runPhoneSync() {
        if (!SupabaseSync.isConfigured()) {
            phoneSyncStatusText.visibility = View.VISIBLE
            phoneSyncStatusText.setTextColor(Color.parseColor("#FBBF24"))
            phoneSyncStatusText.text = getString(R.string.sync_missing_config)
            return
        }
        phoneSyncStatusText.visibility = View.VISIBLE
        phoneSyncStatusText.setTextColor(Color.parseColor("#94A3B8"))
        phoneSyncStatusText.text = getString(R.string.phone_sync_running)
        Thread {
            val r = SystemTelephonySync.syncSmsAndCalls(this)
            runOnUiThread {
                phoneSyncStatusText.setTextColor(
                    when {
                        r.success -> Color.parseColor("#6EE7B7")
                        else -> Color.parseColor("#FCA5A5")
                    }
                )
                phoneSyncStatusText.text = "${getString(R.string.phone_sync_done_prefix)} ${r.message}"
            }
        }.start()
    }

    private fun refreshStatus() {
        val enabled = isNotificationServiceEnabled()
        if (enabled) {
            statusText.text = getString(R.string.status_active)
            statusText.setBackgroundResource(R.drawable.bg_status_active)
            statusText.setTextColor(getColor(android.R.color.white))
            statusHintText.text = getString(R.string.status_help_active)
            grantButton.text = getString(R.string.open_settings)
            batteryStatusText.visibility = View.VISIBLE
            if (BatteryOptimizationHelper.isIgnoringBatteryOptimizations(this)) {
                batteryStatusText.setTextColor(Color.parseColor("#6EE7B7"))
                batteryStatusText.text = getString(R.string.battery_hint_ok)
                batteryOptimizeButton.visibility = View.GONE
            } else {
                batteryStatusText.setTextColor(Color.parseColor("#C5D1E8"))
                batteryStatusText.text = getString(R.string.battery_hint_restricted)
                batteryOptimizeButton.visibility = View.VISIBLE
            }
            DashboardHeartbeatService.start(this)
            syncStatusText.visibility = View.VISIBLE
            if (!SupabaseSync.isConfigured()) {
                syncStatusText.setTextColor(Color.parseColor("#FBBF24"))
                syncStatusText.text = getString(R.string.sync_missing_config)
            } else {
                syncStatusText.setTextColor(Color.parseColor("#94A3B8"))
                syncStatusText.text = getString(R.string.sync_checking)
                SupabaseSync.registerDeviceWithDashboard(this) { ok, message ->
                    if (ok) {
                        syncStatusText.setTextColor(Color.parseColor("#6EE7B7"))
                        syncStatusText.text = getString(R.string.sync_ok)
                    } else {
                        syncStatusText.setTextColor(Color.parseColor("#FCA5A5"))
                        syncStatusText.text = "${getString(R.string.sync_failed_prefix)} $message"
                    }
                }
            }
        } else {
            statusText.text = getString(R.string.status_inactive)
            statusText.setBackgroundResource(R.drawable.bg_status_inactive)
            statusText.setTextColor(getColor(android.R.color.white))
            statusHintText.text = getString(R.string.status_help_inactive)
            grantButton.text = getString(R.string.grant_access)
            batteryStatusText.visibility = View.GONE
            batteryOptimizeButton.visibility = View.GONE
            DashboardHeartbeatService.stop(this)
            syncStatusText.visibility = View.GONE
        }
    }

    companion object {
        private const val REQ_PHONE_PERMS = 4102
    }
}
