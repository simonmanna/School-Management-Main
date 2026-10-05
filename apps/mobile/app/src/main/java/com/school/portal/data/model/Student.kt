package com.school.portal.data.model

import kotlinx.serialization.Serializable

/** GET school/portals/student/:id — the learner's own dashboard. */
@Serializable
data class StudentDashboard(
    val profile: StudentProfile? = null,
    val timetable: List<TimetableSlot> = emptyList(),
    val attendance: AttendanceSummary = AttendanceSummary(),
    val grades: List<DashboardGrade> = emptyList(),
    val assignments: List<DashboardAssignment> = emptyList(),
    val announcements: List<Announcement> = emptyList(),
    /** Published term results, newest first — one row per term. */
    val publishedResults: List<PublishedResult> = emptyList(),
    val certificates: List<Certificate> = emptyList(),
)

@Serializable
data class NamedRef(val name: String = "")

@Serializable
data class GradeLevelRef(val name: String = "")

@Serializable
data class SchoolClassRef(val name: String = "", val gradeLevel: GradeLevelRef? = null)

@Serializable
data class StudentProfile(
    val id: String = "",
    val admissionNo: String = "",
    val currentClass: SchoolClassRef? = null,
    val currentSection: NamedRef? = null,
    val partner: NamedRef? = null,
)

@Serializable
data class PeriodRef(val name: String = "", val startTime: String? = null, val endTime: String? = null)

@Serializable
data class TimetableSlot(
    val id: String = "",
    val dayOfWeek: Int = 0,
    val subject: NamedRef? = null,
    val period: PeriodRef? = null,
    val room: String? = null,
)

/**
 * rate is null when it depends on a late policy the school has not chosen. The
 * UI says so rather than inventing a percentage.
 */
@Serializable
data class AttendanceSummary(
    val total: Int = 0,
    val present: Int = 0,
    val late: Int = 0,
    val absent: Int = 0,
    val rate: Double? = null,
    val policyMissing: Boolean = false,
)

@Serializable
data class AssessmentRef(val id: String = "", val title: String = "")

@Serializable
data class DashboardGrade(
    val id: String = "",
    @Serializable(with = LenientDouble::class) val score: Double? = null,
    @Serializable(with = LenientDouble::class) val maxScore: Double? = null,
    @Serializable(with = LenientDouble::class) val percentage: Double? = null,
    val recordedAt: String? = null,
    val subject: NamedRef? = null,
    val assessment: AssessmentRef? = null,
)

@Serializable
data class DashboardAssignment(
    val id: String = "",
    val title: String = "",
    val status: String = "",
    val dueDate: String? = null,
)

@Serializable
data class Announcement(
    val id: String = "",
    val title: String = "",
    val body: String = "",
    val publishedAt: String? = null,
)

@Serializable
data class PublishedResult(
    val termId: String = "",
    val resultSetRevision: Int = 0,
    val gpa: String? = null,
    val aggregate: Int? = null,
    val division: String? = null,
    val meanPercent: String? = null,
    val classRank: Int? = null,
    val promotionRecommendation: String? = null,
)

@Serializable
data class Certificate(
    val id: String = "",
    val title: String = "",
    val status: String = "",
    val code: String? = null,
)

/** Released report cards. The server never returns an unpublished one. */
@Serializable
data class ReportCard(
    val id: String,
    val termId: String = "",
    val termName: String? = null,
    val generatedAt: String? = null,
    val publishedAt: String? = null,
    val classTeacherComment: String? = null,
    val principalComment: String? = null,
)
