package com.aggregator.socialinbox

import java.util.ArrayDeque

/**
 * Ring buffer of recent notification capture attempts (for the debug screen).
 */
object NotificationCaptureLog {

    private const val MAX = 30
    private val deque = ArrayDeque<Entry>(MAX)

    data class Entry(
        val timeMs: Long,
        val packageName: String,
        val title: String,
        val synced: Boolean,
        val detail: String
    )

    @Synchronized
    fun add(entry: Entry) {
        while (deque.size >= MAX) deque.removeFirst()
        deque.addLast(entry)
    }

    @Synchronized
    fun snapshot(): List<Entry> = deque.toList()
}
