package com.school.portal.ui.common

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException

/**
 * Dates, as a parent reads them.
 *
 * The API sends ISO-8601 in UTC; everything here renders in the device's zone,
 * which is the school's zone in practice. minSdk 26 means java.time is on the
 * platform, so no desugaring and no Joda.
 */

private val dayMonth = DateTimeFormatter.ofPattern("EEE d MMM")
private val dayMonthYear = DateTimeFormatter.ofPattern("d MMM yyyy")
private val dayMonthTime = DateTimeFormatter.ofPattern("EEE d MMM, HH:mm")
private val clock = DateTimeFormatter.ofPattern("HH:mm")

fun parseInstant(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    return runCatching { Instant.parse(iso) }.getOrNull()
        ?: runCatching { LocalDateTime.parse(iso).atZone(ZoneId.systemDefault()).toInstant() }.getOrNull()
        ?: runCatching { LocalDate.parse(iso).atStartOfDay(ZoneId.systemDefault()).toInstant() }.getOrNull()
}

fun formatDate(iso: String?): String =
    parseInstant(iso)?.atZone(ZoneId.systemDefault())?.format(dayMonthYear) ?: "—"

fun formatDateTime(iso: String?): String =
    parseInstant(iso)?.atZone(ZoneId.systemDefault())?.format(dayMonthTime) ?: "—"

/**
 * A due date said the way it matters: how long is left, not when it was set.
 *
 * "Due today" and "2 days late" are the two readings a pupil acts on; an
 * absolute date for anything further out, because "in 23 days" is not something
 * anyone plans against.
 */
fun formatDue(iso: String?): String? {
    val at = parseInstant(iso) ?: return null
    val zone = ZoneId.systemDefault()
    val dueDay = at.atZone(zone).toLocalDate()
    val today = LocalDate.now(zone)
    val days = java.time.temporal.ChronoUnit.DAYS.between(today, dueDay)
    val time = at.atZone(zone).format(clock)
    return when {
        days == 0L -> "today at $time"
        days == 1L -> "tomorrow at $time"
        days == -1L -> "yesterday — late"
        days < -1L -> "${-days} days late"
        days in 2..6 -> "${at.atZone(zone).format(dayMonth)} at $time"
        else -> at.atZone(zone).format(dayMonthYear)
    }
}

/** True when the deadline has passed, as the device sees the clock. */
fun isOverdue(iso: String?): Boolean =
    parseInstant(iso)?.isBefore(Instant.now()) == true

fun formatClock(millis: Long): String {
    val total = (millis / 1000).coerceAtLeast(0)
    return "%d:%02d".format(total / 60, total % 60)
}

fun formatRelative(iso: String?): String {
    val at = parseInstant(iso) ?: return "—"
    val gap = Duration.between(at, Instant.now())
    val minutes = gap.toMinutes()
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min ago"
        minutes < 60 * 24 -> "${gap.toHours()}h ago"
        minutes < 60 * 24 * 7 -> "${gap.toDays()}d ago"
        else -> formatDate(iso)
    }
}

fun formatBytes(bytes: Long?): String = when {
    bytes == null -> ""
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> "%.1f MB".format(bytes / (1024.0 * 1024.0))
}

/** ISO date for an attendance register, which the API takes as yyyy-MM-dd. */
fun today(): String = LocalDate.now().toString()

fun formatDayLabel(isoDate: String): String =
    runCatching { LocalDate.parse(isoDate).format(dayMonth) }.getOrElse { isoDate }

fun shiftDays(isoDate: String, days: Long): String =
    runCatching { LocalDate.parse(isoDate).plusDays(days).toString() }.getOrElse { isoDate }

@Suppress("unused")
private fun unusedParseGuard(e: DateTimeParseException) = e.message

/** Monday-first day name for a timetable row, which the API numbers 1..7. */
fun dayName(dayOfWeek: Int): String = when (dayOfWeek) {
    1 -> "Monday"
    2 -> "Tuesday"
    3 -> "Wednesday"
    4 -> "Thursday"
    5 -> "Friday"
    6 -> "Saturday"
    7 -> "Sunday"
    else -> "Day $dayOfWeek"
}

/** Today's index in the API's 1..7 numbering. */
fun todayDayOfWeek(): Int = LocalDate.now().dayOfWeek.value
