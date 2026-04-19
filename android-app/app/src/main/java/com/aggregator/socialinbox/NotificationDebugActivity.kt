package com.aggregator.socialinbox

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.ListView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class NotificationDebugActivity : AppCompatActivity() {

    private lateinit var listView: ListView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_notification_debug)
        listView = findViewById(R.id.debugList)
        findViewById<TextView>(R.id.debugVersionText).text = getString(
            R.string.app_version_line,
            BuildConfig.VERSION_NAME,
            BuildConfig.VERSION_CODE
        )
        refresh()
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    private fun refresh() {
        val fmt = SimpleDateFormat("HH:mm:ss", Locale.getDefault())
        val lines = NotificationCaptureLog.snapshot().asReversed().map { e ->
            val t = fmt.format(Date(e.timeMs))
            val st = if (e.synced) "✓" else "✗"
            "$t $st ${e.packageName}\n${e.title.take(80)}\n${e.detail}"
        }
        listView.adapter = ArrayAdapter(
            this,
            android.R.layout.simple_list_item_1,
            if (lines.isEmpty()) listOf(getString(R.string.debug_empty)) else lines
        )
    }
}
