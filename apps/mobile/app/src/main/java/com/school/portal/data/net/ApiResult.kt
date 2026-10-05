package com.school.portal.data.net

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import retrofit2.HttpException
import java.io.IOException

/**
 * What went wrong, in words a parent or a teacher can act on.
 *
 * The server's own message is preferred when there is one — it is written for
 * the person reading it ("Fees must be cleared before results are released")
 * and is far more useful than a status code. The fallbacks below are only for
 * when there is nothing to quote.
 */
data class ApiError(
    val status: Int?,
    val message: String,
    val cause: Throwable? = null,
) {
    val isForbidden: Boolean get() = status == 403
    val isNotFound: Boolean get() = status == 404
    val isOffline: Boolean get() = status == null
}

sealed interface ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>
    data class Failed(val error: ApiError) : ApiResult<Nothing>
}

fun <T> ApiResult<T>.valueOrNull(): T? = (this as? ApiResult.Ok)?.value
fun <T> ApiResult<T>.errorOrNull(): ApiError? = (this as? ApiResult.Failed)?.error

/**
 * Runs an API call and turns anything thrown into an [ApiError].
 *
 * Repositories return results rather than throwing so that a screen renders an
 * error state instead of taking the process down: a 403 on the LMS is a rule
 * ("that is not your child"), not a fault, and must not look like a crash.
 */
suspend fun <T> apiCall(block: suspend () -> T): ApiResult<T> = try {
    ApiResult.Ok(block())
} catch (e: HttpException) {
    ApiResult.Failed(ApiError(e.code(), serverMessage(e) ?: defaultMessage(e.code()), e))
} catch (e: IOException) {
    ApiResult.Failed(ApiError(null, "No connection. Check your internet and try again.", e))
} catch (e: Exception) {
    ApiResult.Failed(ApiError(null, e.message ?: "Something went wrong", e))
}

private val lenient = Json { ignoreUnknownKeys = true; isLenient = true }

/** NestJS validation errors arrive as a message ARRAY; take the first line. */
private fun serverMessage(e: HttpException): String? {
    val raw = runCatching { e.response()?.errorBody()?.string() }.getOrNull() ?: return null
    val body = runCatching { lenient.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return null
    return when (val message = body["message"]) {
        is JsonPrimitive -> message.contentOrNull
        is JsonArray -> (message.firstOrNull() as? JsonPrimitive)?.contentOrNull
        else -> null
    }
}

private fun defaultMessage(status: Int): String = when (status) {
    401 -> "Your session has ended. Please sign in again."
    403 -> "You do not have access to that."
    404 -> "That is no longer there."
    in 500..599 -> "The school system is not responding. Please try again shortly."
    else -> "Something went wrong"
}
