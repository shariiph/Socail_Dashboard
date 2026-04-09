package com.aggregator.socialinbox

/**
 * Best-effort redaction before uploading notification text (OTPs, long digit sequences).
 * Not a substitute for avoiding sensitive data in notifications.
 */
object SensitiveDataRedactor {

    private val otpLike = Regex("""\b\d{4,8}\b""")
    private val cardLike = Regex("""\b(?:\d[ \-]*?){13,19}\b""")

    fun redact(text: String, enabled: Boolean): String {
        if (!enabled || text.isEmpty()) return text
        var t = otpLike.replace(text, "[digits redacted]")
        t = cardLike.replace(t, "[number redacted]")
        return t
    }
}
