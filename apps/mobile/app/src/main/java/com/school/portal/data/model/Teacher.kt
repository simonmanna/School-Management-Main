package com.school.portal.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.intOrNull

/**
 * The teacher side.
 *
 * Every write below lands on a route gated on an `:own` grant and re-checked
 * server-side against the caller's StaffProfile. The class or assessment id this
 * app sends is a request, never a permission — a teacher who edits one gets a
 * 403, not somebody else's register.
 */

@Serializable
data class TeachingAssignment(
    val id: String? = null,
    val name: String? = null,
    val classId: String? = null,
    val sectionId: String? = null,
    val schoolClass: NamedRef? = null,
    val section: NamedRef? = null,
    val subject: NamedRef? = null,
)

@Serializable
data class TeacherScheduleSlot(
    val id: String = "",
    val subject: NamedRef? = null,
    val schoolClass: NamedRef? = null,
    val period: PeriodRef? = null,
    val room: String? = null,
)

@Serializable
data class MarkingCounters(val pendingApprovals: Int = 0, val draftMarks: Int = 0)

@Serializable
data class TeacherDashboard(
    /**
     * Teaching ASSIGNMENTS (one per class x subject), not classes: `id` is the
     * assignment's id. Reading it as a class id is what sent the register to an
     * empty roster in the web portal (Wave 16) — use [teachingClasses].
     */
    val classes: List<TeachingAssignment> = emptyList(),
    val todaySchedule: List<TeacherScheduleSlot> = emptyList(),
    /** The API has sent both a count and a list here across versions. */
    val pendingGrades: JsonElement? = null,
    val marking: MarkingCounters = MarkingCounters(),
) {
    val pendingGradeCount: Int
        get() = when (val p = pendingGrades) {
            is JsonArray -> p.size
            is JsonPrimitive -> p.intOrNull ?: 0
            else -> 0
        }
}

/** A distinct class (or stream) a teacher teaches, with the subjects they take there. */
data class TeachingClass(
    val classId: String,
    val sectionId: String?,
    val name: String,
    val subjects: List<String>,
)

/** Collapse assignments into the classes behind them. */
fun TeacherDashboard?.teachingClasses(): List<TeachingClass> {
    val byKey = LinkedHashMap<String, TeachingClass>()
    for (a in this?.classes ?: emptyList()) {
        val classId = a.classId ?: continue
        val key = "$classId:${a.sectionId ?: ""}"
        val name = listOfNotNull(
            a.schoolClass?.name ?: a.name ?: "Class",
            a.section?.name,
        ).joinToString(" ")
        val existing = byKey[key] ?: TeachingClass(classId, a.sectionId, name, emptyList())
        val subject = a.subject?.name
        byKey[key] = if (subject != null && subject !in existing.subjects) {
            existing.copy(subjects = existing.subjects + subject)
        } else {
            existing
        }
    }
    return byKey.values.sortedBy { it.name }
}

@Serializable
data class LessonPlanCounters(val draft: Int = 0, val submitted: Int = 0, val approved: Int = 0)

@Serializable
data class ExamPaperProgress(
    val examScheduleId: String = "",
    val examName: String = "",
    val subject: String = "",
    val classId: String = "",
    val entered: Int = 0,
    val total: Int = 0,
)

@Serializable
data class TeacherOverview(
    val lessonPlans: LessonPlanCounters = LessonPlanCounters(),
    val examPapers: List<ExamPaperProgress> = emptyList(),
)

/* ── Attendance ─────────────────────────────────────────────────────────── */

/**
 * The school's own status flags — these, not the list order, say what a status
 * means (R10). A register that assumes "the first one is Present" marks the
 * wrong thing at a school that renamed its codes.
 */
@Serializable
data class AttendanceStatusOption(
    val id: String,
    val code: String = "",
    val label: String = "",
    val isDefault: Boolean? = null,
    val isPresent: Boolean? = null,
    val isLate: Boolean? = null,
    val isAbsent: Boolean? = null,
    val isExcused: Boolean? = null,
    val sortOrder: Int? = null,
    val active: Boolean = true,
)

@Serializable
data class ClassRosterPupil(
    val id: String,
    val admissionNo: String = "",
    val partner: NamedRef? = null,
) {
    val name: String get() = partner?.name?.ifBlank { null } ?: admissionNo
}

/** What has already been marked for this class on this date. */
@Serializable
data class RegisterRow(
    val id: String = "",
    val studentProfileId: String = "",
    val status: String = "",
    val minutesLate: Int = 0,
)

@Serializable
data class MarkRegisterEntry(
    val studentProfileId: String,
    val status: String,
    val minutesLate: Int? = null,
)

@Serializable
data class MarkRegisterRequest(
    val classId: String,
    val date: String,
    val entries: List<MarkRegisterEntry>,
)

/* ── Marking ────────────────────────────────────────────────────────────── */

/** An assessment the signed-in teacher may mark (GET school/marking/mine). */
@Serializable
data class MyAssessment(
    val id: String,
    val title: String = "",
    val kind: String = "",
    val status: String = "",
    @Serializable(with = LenientDouble::class) val maxScore: Double? = null,
    val dueAt: String? = null,
    val termId: String = "",
    val termName: String? = null,
    val classId: String? = null,
    val className: String? = null,
    val sectionName: String? = null,
    val subjectName: String? = null,
    val total: Int = 0,
    val entered: Int = 0,
    val draft: Int = 0,
    val submitted: Int = 0,
    val approved: Int = 0,
)

@Serializable
data class MarkSheetRow(
    val id: String,
    val studentProfileId: String = "",
    val studentName: String? = null,
    val admissionNo: String? = null,
    @Serializable(with = LenientDouble::class) val maxScore: Double? = null,
    @Serializable(with = LenientDouble::class) val effectiveScore: Double? = null,
    val approvalStatus: String = "",
    val participation: String = "",
    val version: Int? = null,
)

@Serializable
data class RecordMarkRequest(val studentAssessmentId: String, val score: Double)

@Serializable
data class SubmitMarksRequest(val assessmentId: String)
