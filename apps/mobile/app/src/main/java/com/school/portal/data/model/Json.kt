package com.school.portal.data.model

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull

/**
 * Reading an activity's plugin body.
 *
 * The envelope keeps `body` deliberately untyped — it belongs to whichever
 * plugin owns the activity, and the spine does not know its shape. These
 * accessors are how a screen reads the keys its own plugin documents without a
 * data class per plugin, and every one of them tolerates an absent or
 * differently-typed key rather than throwing on a phone.
 */

fun JsonObject?.obj(key: String): JsonObject? = this?.get(key) as? JsonObject

fun JsonObject?.arr(key: String): JsonArray? = this?.get(key) as? JsonArray

/** A string, or a number read as one. JSON null reads as absent, never as "null". */
fun JsonObject?.str(key: String): String? {
    val primitive = this?.get(key) as? JsonPrimitive ?: return null
    if (primitive is JsonNull) return null
    return primitive.content.takeIf { it.isNotEmpty() }
}

fun JsonObject?.int(key: String): Int? = (this?.get(key) as? JsonPrimitive)?.intOrNull

fun JsonObject?.double(key: String): Double? = (this?.get(key) as? JsonPrimitive)?.doubleOrNull

fun JsonObject?.bool(key: String): Boolean? = (this?.get(key) as? JsonPrimitive)?.booleanOrNull

fun JsonObject?.strings(key: String): List<String> =
    arr(key)?.mapNotNull { (it as? JsonPrimitive)?.content }.orEmpty()

/** The plugin's own instance row, which is where a page's content or a quiz's settings live. */
fun JsonObject?.instance(): JsonObject? = obj("instance") ?: this

/** A file reference as the LMS file service returns it. */
fun JsonObject.toFileRef(): FileRef? {
    val id = str("id") ?: return null
    return FileRef(
        id = id,
        filename = str("filename") ?: str("originalName") ?: "file",
        byteSize = (this["byteSize"] as? JsonPrimitive)?.content?.toLongOrNull(),
    )
}

fun JsonArray?.toFileRefs(): List<FileRef> =
    this?.mapNotNull { (it as? JsonObject)?.toFileRef() }.orEmpty()
