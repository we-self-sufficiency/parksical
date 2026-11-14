package com.parksical.data.remote

import android.content.Context
import android.util.Log
import com.parksical.BuildConfig
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Instant

sealed interface AuthState {
    data object SignedOut : AuthState
    data object Pairing : AuthState
    data object SignedIn : AuthState
    data class Error(val reason: String) : AuthState
}

/** Holds the VEHICLE session from /auth/vehicle-links pairing. Never throws from [accessToken]. */
class AuthRepository(context: Context, private val api: ApiClient) {
    // shortcut: plain SharedPreferences, move to EncryptedSharedPreferences/Keystore before release
    private val prefs = context.applicationContext.getSharedPreferences("parksical_auth", Context.MODE_PRIVATE)
    private val mutex = Mutex()

    private val _state = MutableStateFlow<AuthState>(
        if (prefs.getString(K_REFRESH, null) != null) AuthState.SignedIn else AuthState.SignedOut,
    )
    val state: StateFlow<AuthState> = _state

    private val _pairingCode = MutableStateFlow<String?>(null)
    /** Last userCode, for a future "approve on your phone" screen. */
    val pairingCode: StateFlow<String?> = _pairingCode

    /** Valid access token, or null when no session can be established. */
    suspend fun accessToken(): String? = mutex.withLock {
        try {
            val now = System.currentTimeMillis()
            val access = prefs.getString(K_ACCESS, null)
            if (access != null && prefs.getLong(K_EXPIRY, 0) - SKEW_MS > now) return@withLock access
            val refresh = prefs.getString(K_REFRESH, null)
            if (refresh != null) refresh(refresh)?.let { return@withLock it }
            pair()
        } catch (e: Exception) {
            Log.d(ApiClient.TAG, "auth failed ${e.javaClass.simpleName}")
            if (_state.value !is AuthState.Pairing) _state.value = AuthState.Error(e.message ?: "인증 실패")
            null
        }
    }

    /** Forget only the access token (server said 401); the next [accessToken] refreshes. */
    fun invalidate() { prefs.edit().remove(K_ACCESS).remove(K_EXPIRY).apply() }

    private suspend fun refresh(refreshToken: String): String? = try {
        val r = api.request("POST", "/auth/refresh", body = JSONObject().put("refreshToken", refreshToken))
        store(r.body!!)
    } catch (e: ApiException) {
        // refresh tokens are single-use: a 401 means this session is gone
        if (e.status == 401) clearTokens()
        null
    }

    private suspend fun pair(): String? {
        val devKey = BuildConfig.PARKSICAL_DEV_AUTH_KEY
        _state.value = AuthState.Pairing
        val start = JSONObject()
        val id = prefs.getString(K_INST_ID, null)
        val secret = prefs.getString(K_INST_SECRET, null)
        if (id != null && secret != null) start.put("installationId", id).put("installationSecret", secret)
        val grant = api.request("POST", "/auth/vehicle-links", body = start).body!!
        prefs.edit()
            .putString(K_INST_ID, grant.getString("installationId"))
            .apply { grant.optString("installationSecret").takeIf { it.isNotEmpty() }?.let { putString(K_INST_SECRET, it) } }
            .apply()
        val userCode = grant.getString("userCode")
        _pairingCode.value = userCode
        if (devKey.isEmpty()) return null // real approval happens on the phone; UI is out of scope

        val web = api.request(
            "POST", "/auth/development/login",
            body = JSONObject().put("subject", "pjk-demo-vehicle"),
            extraHeaders = mapOf("X-Development-Key" to devKey),
        ).body!!.getString("accessToken")
        api.request("POST", "/auth/vehicle-links/approve", body = JSONObject().put("userCode", userCode), bearer = web)
        runCatching { api.request("POST", "/auth/logout", bearer = web) }

        repeat(3) {
            try {
                val r = api.request("POST", "/auth/vehicle-links/exchange", body = JSONObject().put("deviceCode", grant.getString("deviceCode")))
                _pairingCode.value = null
                return store(r.body!!)
            } catch (e: ApiException) {
                if (e.code != "AUTHORIZATION_PENDING") throw e
                delay((e.retryAfterSec ?: 5) * 1000L)
            }
        }
        return null
    }

    private fun store(tokens: JSONObject): String {
        val access = tokens.getString("accessToken")
        prefs.edit()
            .putString(K_ACCESS, access)
            .putString(K_REFRESH, tokens.getString("refreshToken"))
            .putLong(K_EXPIRY, Instant.parse(tokens.getString("accessExpiresAt")).toEpochMilli())
            .apply()
        _state.value = AuthState.SignedIn
        return access
    }

    private fun clearTokens() {
        prefs.edit().remove(K_ACCESS).remove(K_REFRESH).remove(K_EXPIRY).apply()
        _state.value = AuthState.SignedOut
    }

    private companion object {
        const val K_ACCESS = "access"; const val K_REFRESH = "refresh"; const val K_EXPIRY = "expiry"
        const val K_INST_ID = "installationId"; const val K_INST_SECRET = "installationSecret"
        const val SKEW_MS = 30_000L
    }
}
