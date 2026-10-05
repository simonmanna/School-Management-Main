package com.school.portal

import com.school.portal.data.model.GradeDisplay
import com.school.portal.data.model.MarkSheetRow
import com.school.portal.data.model.ModuleGrade
import com.school.portal.data.model.MyAssessment
import com.school.portal.data.model.NamedRef
import com.school.portal.data.model.TeacherDashboard
import com.school.portal.data.model.TeachingAssignment
import com.school.portal.data.model.describe
import com.school.portal.data.model.teachingClasses
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The contract tests that matter on a phone: the places where the API's real
 * shape has already bitten the web portal, and where getting it wrong shows a
 * family the wrong number rather than an error.
 */
class ContractTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    @Test
    fun `a decimal sent as a string parses`() {
        // Prisma Decimal columns serialise as strings.
        val row = json.decodeFromString<MarkSheetRow>(
            """{"id":"sa1","studentProfileId":"s1","maxScore":"40","effectiveScore":"33.5","approvalStatus":"DRAFT","participation":"PRESENT"}""",
        )
        assertEquals(40.0, row.maxScore)
        assertEquals(33.5, row.effectiveScore)
    }

    @Test
    fun `the same field sent as a number also parses`() {
        val assessment = json.decodeFromString<MyAssessment>(
            """{"id":"a1","title":"Test","maxScore":40,"termId":"t1"}""",
        )
        assertEquals(40.0, assessment.maxScore)
    }

    @Test
    fun `an unapproved mark is withheld, never shown as zero`() {
        val grade = ModuleGrade(assessmentId = "a1", maxScore = 20.0, score = null)
        assertTrue(grade.describe() is GradeDisplay.Withheld)
    }

    @Test
    fun `an approved mark renders without a trailing decimal`() {
        val grade = ModuleGrade(assessmentId = "a1", maxScore = 20.0, score = 17.0, percentage = 85.0)
        val shown = grade.describe()
        assertTrue(shown is GradeDisplay.Scored)
        assertEquals("17 / 20", (shown as GradeDisplay.Scored).label)
    }

    @Test
    fun `no assessment behind an activity means no mark card at all`() {
        assertTrue(ModuleGrade(maxScore = 10.0).describe() is GradeDisplay.None)
        assertTrue(null.describe() is GradeDisplay.None)
    }

    @Test
    fun `teaching assignments collapse into classes, keyed on the class not the assignment`() {
        // Reading an assignment's own id as a class id is what sent the web
        // portal's register to an empty roster (Wave 16).
        val dashboard = TeacherDashboard(
            classes = listOf(
                TeachingAssignment(
                    id = "assignment-1",
                    classId = "class-7",
                    sectionId = "sec-a",
                    schoolClass = NamedRef("P7"),
                    section = NamedRef("A"),
                    subject = NamedRef("Maths"),
                ),
                TeachingAssignment(
                    id = "assignment-2",
                    classId = "class-7",
                    sectionId = "sec-a",
                    schoolClass = NamedRef("P7"),
                    section = NamedRef("A"),
                    subject = NamedRef("Science"),
                ),
                TeachingAssignment(
                    id = "assignment-3",
                    classId = "class-6",
                    schoolClass = NamedRef("P6"),
                    subject = NamedRef("Maths"),
                ),
            ),
        )

        val classes = dashboard.teachingClasses()
        assertEquals(2, classes.size)
        val p7 = classes.single { it.name == "P7 A" }
        assertEquals("class-7", p7.classId)
        assertEquals(listOf("Maths", "Science"), p7.subjects)
    }

    @Test
    fun `an assignment with no class id is dropped rather than guessed at`() {
        val dashboard = TeacherDashboard(classes = listOf(TeachingAssignment(id = "assignment-1")))
        assertTrue(dashboard.teachingClasses().isEmpty())
    }

    @Test
    fun `pendingGrades parses whether the API sends a count or a list`() {
        val asCount = json.decodeFromString<TeacherDashboard>("""{"pendingGrades":4}""")
        val asList = json.decodeFromString<TeacherDashboard>("""{"pendingGrades":[{},{},{}]}""")
        val absent = json.decodeFromString<TeacherDashboard>("""{}""")
        assertEquals(4, asCount.pendingGradeCount)
        assertEquals(3, asList.pendingGradeCount)
        assertEquals(0, absent.pendingGradeCount)
    }

    @Test
    fun `a null attendance rate stays null instead of becoming a percentage`() {
        // rate is null when the school has not chosen a late policy; inventing
        // one here would contradict the office.
        val dashboard = json.decodeFromString<com.school.portal.data.model.StudentDashboard>(
            """{"attendance":{"total":10,"present":9,"late":1,"absent":0,"rate":null,"policyMissing":true}}""",
        )
        assertNull(dashboard.attendance.rate)
        assertTrue(dashboard.attendance.policyMissing)
    }
}
