package com.aggregator.socialinbox

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Shared HTTP client for Supabase REST: timeouts, connection retry, and POST retries for
 * 429 / 5xx / [IOException] (within [maxAttempts]).
 */
object SupabaseHttp {

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(25, TimeUnit.SECONDS)
        .readTimeout(45, TimeUnit.SECONDS)
        .writeTimeout(45, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()

    private fun buildPost(url: String, apiKey: String, jsonBody: String): Request {
        val body = jsonBody.toRequestBody(jsonMedia)
        return Request.Builder()
            .url(url)
            .post(body)
            .addHeader("apikey", apiKey)
            .addHeader("Authorization", "Bearer $apiKey")
            .addHeader("Content-Type", "application/json")
            .addHeader("Prefer", "resolution=merge-duplicates")
            .build()
    }

    /**
     * Caller must [Response.use] or [Response.close].
     */
    @Throws(IOException::class)
    fun postJsonWithRetry(
        url: String,
        apiKey: String,
        jsonBody: String,
        maxAttempts: Int = 3
    ): Response {
        require(maxAttempts >= 1)
        for (attempt in 0 until maxAttempts) {
            val response = try {
                client.newCall(buildPost(url, apiKey, jsonBody)).execute()
            } catch (e: IOException) {
                if (attempt >= maxAttempts - 1) throw e
                Thread.sleep((350L * (attempt + 1)).coerceAtMost(2500L))
                continue
            }

            when {
                response.isSuccessful -> return response
                response.code != 429 && response.code < 500 -> return response
                else -> {
                    val canRetry = (response.code == 429 || response.code >= 500) && attempt < maxAttempts - 1
                    if (!canRetry) return response
                    response.close()
                    Thread.sleep((350L * (attempt + 1)).coerceAtMost(2500L))
                }
            }
        }
        throw IOException("postJsonWithRetry: no response")
    }
}
