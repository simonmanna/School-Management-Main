package com.school.portal.data.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

/**
 * A money or mark figure that the API sends sometimes as a number and sometimes
 * as a string.
 *
 * This is not sloppiness to paper over: Prisma Decimal columns serialise as
 * strings while computed figures come back as JSON numbers, so the same field
 * legitimately arrives both ways depending on which service built it. A strict
 * deserializer would crash the screen on whichever half it did not expect.
 */
@OptIn(kotlinx.serialization.ExperimentalSerializationApi::class)
object LenientDouble : KSerializer<Double?> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("LenientDouble", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Double? {
        val json = decoder as? JsonDecoder ?: return decoder.decodeDouble()
        return when (val element = json.decodeJsonElement()) {
            is JsonNull -> null
            is JsonPrimitive -> element.doubleOrNull ?: element.content.toDoubleOrNull()
            else -> null
        }
    }

    override fun serialize(encoder: Encoder, value: Double?) {
        if (value == null) encoder.encodeNull() else encoder.encodeDouble(value)
    }
}

/** Drops the trailing ".0" that a whole mark would otherwise show on screen. */
fun Double.tidy(): String =
    if (this % 1.0 == 0.0) toLong().toString() else String.format(java.util.Locale.US, "%.1f", this)

fun Double?.tidyOrDash(): String = this?.tidy() ?: "—"
