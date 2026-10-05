package com.school.portal.data.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * The LMS view envelope, mirroring the server's view-envelope.types.ts and the
 * web portal's lms-types.ts.
 *
 * The point of the envelope is that a client dispatches on module.activityType
 * instead of sniffing the response shape — so body stays a JsonObject here and
 * each activity screen reads the keys its own plugin documents. Keep all three
 * copies in step.
 */

@Serializable
data class ModuleAvailability(
    val available: Boolean = true,
    val reasons: List<String> = emptyList(),
    val greyed: Boolean = false,
)

@Serializable
data class ModuleCompletion(
    val mode: String = "none",
    val state: String = "incomplete",
    val overridden: Boolean = false,
) {
    val done: Boolean get() = state != "incomplete"
    val manual: Boolean get() = mode == "manual"
}

@Serializable
data class ModuleGrade(
    val assessmentId: String? = null,
    val maxScore: Double = 0.0,
    /**
     * Null until the mark is APPROVED. Never render null as zero: "not released
     * yet" and "scored nothing" must stay distinct, which is the whole reason
     * the server withholds the figure rather than sending 0.
     */
    val score: Double? = null,
    val percentage: Double? = null,
    val submissionStatus: String? = null,
    val released: Boolean = false,
)

@Serializable
data class CourseModuleView(
    val id: String,
    val activityType: String = "",
    val name: String = "",
    val intro: String? = null,
    val icon: String = "",
    val visible: Boolean = true,
    val sectionId: String? = null,
    val sequence: Int = 0,
    val openAt: String? = null,
    val dueAt: String? = null,
    val cutoffAt: String? = null,
    val gradable: Boolean = false,
    val availability: ModuleAvailability? = null,
    val completion: ModuleCompletion? = null,
    val grade: ModuleGrade? = null,
)

@Serializable
data class CourseSectionView(
    val id: String,
    val sectionNo: Int = 0,
    val name: String? = null,
    val summary: String? = null,
    val visible: Boolean = true,
    val weekOf: String? = null,
    val availability: ModuleAvailability? = null,
    val modules: List<CourseModuleView> = emptyList(),
)

@Serializable
data class CourseHeader(
    val id: String = "",
    val name: String = "",
    val subject: String? = null,
    val className: String? = null,
    val term: String? = null,
    val academicYear: String? = null,
    val format: String = "topics",
    val summary: String? = null,
    val visible: Boolean = true,
    val completionEnabled: Boolean = false,
    val showGradesToStudents: Boolean = true,
    val startDate: String? = null,
    val endDate: String? = null,
)

@Serializable
data class CourseProgress(val completed: Int = 0, val tracked: Int = 0, val percent: Int = 0)

@Serializable
data class ViewingAs(val kind: String = "student", val studentProfileId: String? = null)

/**
 * One enrolled course. The server spreads the course header with its progress
 * (learner.service.ts#myCourses), so id is the course offering's id and the
 * figure to show is progress.percent.
 */
@Serializable
data class MyCourse(
    val id: String = "",
    val name: String = "",
    val subject: String? = null,
    val className: String? = null,
    val term: String? = null,
    val summary: String? = null,
    val completionEnabled: Boolean = false,
    val progress: CourseProgress = CourseProgress(),
)

@Serializable
data class MyCoursesResponse(
    val studentProfileId: String? = null,
    val courses: List<MyCourse> = emptyList(),
)

@Serializable
data class CoursePageView(
    val course: CourseHeader = CourseHeader(),
    val sections: List<CourseSectionView> = emptyList(),
    val capabilities: List<String> = emptyList(),
    val progress: CourseProgress? = null,
    val viewingAs: ViewingAs = ViewingAs(),
)

@Serializable
data class ModuleViewEnvelope(
    val module: CourseModuleView,
    val course: CourseHeader = CourseHeader(),
    val capabilities: List<String> = emptyList(),
    val viewingAs: ViewingAs = ViewingAs(),
    val audience: String = "student",
    val body: JsonObject? = null,
)

/**
 * A piece of work that is actually actionable. The server already drops anything
 * hidden, unavailable, handed in or marked — if it is on this list, it is still
 * to do, so there is no submitted flag to read.
 */
@Serializable
data class DueItem(
    val id: String,
    val activityType: String = "",
    val name: String = "",
    val dueAt: String? = null,
    val courseId: String? = null,
    val courseName: String? = null,
    val overdue: Boolean = false,
    val grade: ModuleGrade? = null,
)

/** Marks that have actually been released: APPROVED and past their release date. */
@Serializable
data class ReleasedGrade(
    val assessmentId: String = "",
    val title: String = "",
    val score: Double? = null,
    val maxScore: Double = 0.0,
    val percentage: Double? = null,
    val at: String? = null,
)

/** LMS capability strings this app checks. Mirrors moodle/capabilities.ts. */
object Caps {
    const val ASSIGN_SUBMIT = "mod/assign:submit"
    const val QUIZ_ATTEMPT = "mod/quiz:attempt"
}

fun List<String>?.can(capability: String): Boolean = this?.contains(capability) == true

/** How a mark reads to a learner: absent, withheld by moderation, or a figure. */
sealed interface GradeDisplay {
    data object None : GradeDisplay
    data object Withheld : GradeDisplay
    data class Scored(val label: String, val percent: Double?) : GradeDisplay
}

fun ModuleGrade?.describe(): GradeDisplay {
    if (this == null || assessmentId == null) return GradeDisplay.None
    if (score == null) return GradeDisplay.Withheld
    return GradeDisplay.Scored("${score.tidy()} / ${maxScore.tidy()}", percentage)
}
