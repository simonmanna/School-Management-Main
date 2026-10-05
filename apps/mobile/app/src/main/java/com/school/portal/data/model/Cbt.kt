package com.school.portal.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Sitting a quiz.
 *
 * The CBT engine owns the attempt: it realises the questions, persists each
 * response, marks the objective ones, counts attempts and decides when time is
 * up — and it refuses a save that arrives after expiry. This app navigates,
 * autosaves and submits. It never scores anything, and the countdown it draws
 * is a courtesy rather than the rule.
 */

@Serializable
data class StartAttemptRequest(val paperId: String, val studentProfileId: String)

@Serializable
data class AttemptOption(val id: String, val label: String = "")

@Serializable
data class AttemptQuestion(
    val questionId: String,
    val type: String = "",
    @Serializable(with = LenientDouble::class) val marks: Double? = null,
    val prompt: String = "",
    val options: List<AttemptOption> = emptyList(),
)

@Serializable
data class Attempt(
    val id: String,
    val status: String = "in_progress",
    /** The server's deadline. A save that arrives after it is refused there. */
    val expiresAt: String? = null,
    val questions: List<AttemptQuestion> = emptyList(),
) {
    val handedIn: Boolean get() = status == "submitted" || status == "auto_submitted"
}

/**
 * Response shapes are the marker's contract (cbt/cbt-marking.ts): {optionId}
 * for a single choice, {optionIds} for several, {value} for a number, {text}
 * for anything written.
 */
@Serializable
data class SaveResponseRequest(
    val attemptId: String,
    val questionId: String,
    val response: JsonObject,
    val sequenceNumber: Int,
    /** Lets the server discard a duplicate when the network retries. */
    val clientEventId: String? = null,
)

@Serializable
data class SubmitAttemptRequest(val attemptId: String, val idempotencyKey: String? = null)
