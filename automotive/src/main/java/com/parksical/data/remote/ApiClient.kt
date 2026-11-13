package com.parksical.data.remote

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Non-2xx answer from the server. [status] 0 = no HTTP response (network failure). */
class ApiException(
    val status: Int,
    val code: String? = null,
    val retryable: Boolean = false,
    val retryAfterSec: Int? = null,
    cause: Throwable? = null,
) : Exception("HTTP $status ${code ?: ""}", cause)

class ApiResponse(val status: Int, val body: JSONObject?, val headers: Map<String, String>)

/** Short Korean banner text for a failed lots call. */
fun fallbackReason(e: Throwable): String = when {
    e is ApiException && e.status == 404 -> "서버에 주차장 API 없음"
    e is ApiException && e.status in 1..599 -> "서버 오류"
    e is ApiException -> "서버 연결 안 됨"
    e is java.io.IOException -> "서버 연결 안 됨"
    else -> "서버 오류" // parse errors etc.
}

/** HttpURLConnection + org.json only. [baseUrl] ends with /api/v1. Never logs tokens, codes or coordinates. */
class ApiClient(val baseUrl: String) {

    /** [query] values are URL-encoded here. Throws [ApiException] for non-2xx or network failure. */
    suspend fun request(
        method: String,
        path: String,
        query: Map<String, String> = emptyMap(),
        body: JSONObject? = null,
        bearer: String? = null,
        idempotencyKey: String? = null,
        extraHeaders: Map<String, String> = emptyMap(),
    ): ApiResponse = withContext(Dispatchers.IO) {
        val qs = if (query.isEmpty()) "" else "?" + query.entries.joinToString("&") {
            it.key + "=" + URLEncoder.encode(it.value, "UTF-8")
        }
        var conn: HttpURLConnection? = null
        try {
            conn = (URL(baseUrl.trimEnd('/') + path + qs).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 5_000
                readTimeout = 10_000
                setRequestProperty("Accept", "application/json")
                bearer?.let { setRequestProperty("Authorization", "Bearer $it") }
                idempotencyKey?.let { setRequestProperty("Idempotency-Key", it) }
                extraHeaders.forEach { (k, v) -> setRequestProperty(k, v) }
                if (body != null) {
                    doOutput = true
                    setRequestProperty("Content-Type", "application/json")
                    outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
            }
            val status = conn.responseCode
            Log.d(TAG, "$method $path -> $status")
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            val json = runCatching { if (text.isBlank()) null else JSONObject(text) }.getOrNull()
            val headers = mapOf("retry-after" to (conn.getHeaderField("Retry-After") ?: ""))
            if (status in 200..299) return@withContext ApiResponse(status, json, headers)
            val err = json?.optJSONObject("error")
            throw ApiException(
                status = status,
                code = err?.optString("code")?.takeIf { it.isNotEmpty() },
                retryable = err?.optBoolean("retryable", false) ?: false,
                retryAfterSec = headers["retry-after"]?.toIntOrNull(),
            )
        } catch (e: ApiException) {
            throw e
        } catch (e: Exception) {
            Log.d(TAG, "$method $path -> failed ${e.javaClass.simpleName}")
            throw ApiException(0, cause = e)
        } finally {
            conn?.disconnect()
        }
    }

    companion object { const val TAG = "ParksicalApi" }
}
