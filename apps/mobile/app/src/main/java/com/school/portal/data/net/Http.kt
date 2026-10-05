package com.school.portal.data.net

import com.school.portal.BuildConfig
import com.school.portal.data.model.RefreshRequest
import com.school.portal.data.model.RefreshResponse
import com.school.portal.data.prefs.SessionStore
import kotlinx.serialization.json.Json
import okhttp3.Authenticator
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.Route
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** The API prefix every route in this app sits under, as the NestJS app mounts it. */
const val API_PREFIX = "api/v1"

val AppJson: Json = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    coerceInputValues = true
    isLenient = true
}

/**
 * Rewrites each request onto whichever origin the device is configured for.
 *
 * Retrofit fixes its base URL at build time, but the origin here is a runtime
 * setting — the emulator reaches the host on 10.0.2.2, a phone on the school
 * wifi needs the LAN address, and the same APK has to serve both without being
 * rebuilt. Only scheme, host and port are replaced, so the /api/v1 path the
 * interfaces declare is preserved.
 */
class OriginInterceptor(private val session: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val configured = session.baseUrlNow().toHttpUrlOrNull()
            ?: return chain.proceed(chain.request())
        val request = chain.request()
        val rewritten: HttpUrl = request.url.newBuilder()
            .scheme(configured.scheme)
            .host(configured.host)
            .port(configured.port)
            .build()
        return chain.proceed(request.newBuilder().url(rewritten).build())
    }
}

/** Attaches the bearer token. Requests tagged [NoAuth] are left alone. */
class AuthInterceptor(private val session: SessionStore) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        if (request.header(HEADER_NO_AUTH) != null) {
            return chain.proceed(request.newBuilder().removeHeader(HEADER_NO_AUTH).build())
        }
        val token = session.accessTokenNow() ?: return chain.proceed(request)
        return chain.proceed(
            request.newBuilder().header("Authorization", "Bearer $token").build(),
        )
    }
}

/**
 * Refreshes an expired access token once, for the whole app.
 *
 * OkHttp calls an authenticator only on a 401 and only once per request, which
 * is what the web portal had to build by hand as a single-flight promise: six
 * dashboard queries on a stale token would otherwise fire six refreshes and
 * rotate the refresh token out from under five of them. The `synchronized`
 * block plus the "has the token already changed?" check does the same job here.
 *
 * A refresh that fails ends the session: the token is genuinely dead, and
 * clearing it is what sends the UI back to the sign-in screen.
 */
class TokenAuthenticator(
    private val session: SessionStore,
    private val onSessionEnded: () -> Unit,
) : Authenticator {

    private val bare = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    override fun authenticate(route: Route?, response: Response): Request? {
        val stale = response.request.header("Authorization")?.removePrefix("Bearer ")?.trim()
        synchronized(this) {
            val current = session.accessTokenNow()
            // Another request already refreshed while this one was queued: retry
            // with what it got rather than spending a second refresh token.
            if (current != null && current != stale) return retryWith(response.request, current)

            val refreshToken = session.refreshTokenNow() ?: return endSession()
            val fresh = runCatching { refresh(refreshToken) }.getOrNull() ?: return endSession()
            session.saveTokens(fresh.accessToken, fresh.refreshToken)
            return retryWith(response.request, fresh.accessToken)
        }
    }

    private fun retryWith(request: Request, token: String): Request =
        request.newBuilder().header("Authorization", "Bearer $token").build()

    private fun endSession(): Request? {
        session.clear()
        onSessionEnded()
        return null
    }

    private fun refresh(refreshToken: String): RefreshResponse? {
        val origin = session.baseUrlNow().trimEnd('/')
        val body = AppJson.encodeToString(RefreshRequest(refreshToken))
            .toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("$origin/$API_PREFIX/auth/refresh")
            .post(body)
            .build()
        bare.newCall(request).execute().use { res ->
            if (!res.isSuccessful) return null
            val text = res.body.string()
            return runCatching { AppJson.decodeFromString<RefreshResponse>(text) }.getOrNull()
        }
    }
}

const val HEADER_NO_AUTH = "X-No-Auth"

/** Builds the one HTTP client and Retrofit instance the app uses. */
object HttpFactory {

    fun client(session: SessionStore, onSessionEnded: () -> Unit): OkHttpClient =
        OkHttpClient.Builder()
            .addInterceptor(OriginInterceptor(session))
            .addInterceptor(AuthInterceptor(session))
            .authenticator(TokenAuthenticator(session, onSessionEnded))
            .apply {
                if (BuildConfig.DEBUG) {
                    // Headers only: the bodies here carry pupils' marks, fees and
                    // attendance, which have no business in logcat even in debug.
                    addInterceptor(
                        HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BASIC },
                    )
                }
            }
            // A school's uplink is often a phone tether; 30s matches the web
            // portal's axios timeout rather than failing earlier on the same call.
            .connectTimeout(20, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(60, TimeUnit.SECONDS)
            .retryOnConnectionFailure(true)
            .build()

    fun retrofit(client: OkHttpClient): Retrofit =
        Retrofit.Builder()
            // A placeholder origin: OriginInterceptor replaces it on every call.
            .baseUrl("http://localhost/$API_PREFIX/")
            .client(client)
            .addConverterFactory(AppJson.asConverterFactory("application/json".toMediaType()))
            .build()
}
