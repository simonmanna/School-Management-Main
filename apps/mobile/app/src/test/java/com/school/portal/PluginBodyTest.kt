package com.school.portal

import com.school.portal.data.model.ModuleViewEnvelope
import com.school.portal.data.model.arr
import com.school.portal.data.model.bool
import com.school.portal.data.model.instance
import com.school.portal.data.model.int
import com.school.portal.data.model.obj
import com.school.portal.data.model.str
import com.school.portal.data.model.toFileRefs
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Reading a plugin body.
 *
 * The envelope leaves `body` untyped on purpose, so these tests pin the keys
 * each activity screen actually reads — the compiler cannot.
 */
class PluginBodyTest {

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

    private fun envelope(body: String) = json.decodeFromString<ModuleViewEnvelope>(
        """{"module":{"id":"cm1","activityType":"assign","name":"Homework"},"body":$body}""",
    )

    @Test
    fun `an assignment body yields its submission, attempts and window`() {
        val view = envelope(
            """
            {
              "instance": { "intro": "<p>Do question 3</p>", "submissionTypes": ["online_text","file"] },
              "submission": {
                "status": "submitted",
                "content": "my answer",
                "files": [ { "id": "f1", "filename": "work.jpg", "byteSize": "2048" } ]
              },
              "attemptsUsed": 1,
              "maxAttempts": 2,
              "canSubmit": true
            }
            """.trimIndent(),
        )
        val instance = view.body.instance()
        assertEquals("<p>Do question 3</p>", instance.str("intro"))
        assertEquals(listOf("online_text", "file"), instance.arr("submissionTypes")?.map { it.toString().trim('"') })
        assertEquals("submitted", view.body.obj("submission").str("status"))
        assertEquals(1, view.body.int("attemptsUsed"))
        assertEquals(true, view.body.bool("canSubmit"))

        val files = view.body.obj("submission").arr("files").toFileRefs()
        assertEquals(1, files.size)
        assertEquals("work.jpg", files[0].filename)
        assertEquals(2048L, files[0].byteSize)
    }

    @Test
    fun `a quiz with no paper behind it reads as having no paper`() {
        val view = envelope("""{ "instance": { "maxAttempts": 3 }, "attemptsUsed": 0 }""")
        assertNull(view.body.str("paperId"))
        assertEquals(3, view.body.instance().int("maxAttempts"))
    }

    @Test
    fun `a missing body does not throw`() {
        val view = json.decodeFromString<ModuleViewEnvelope>(
            """{"module":{"id":"cm1","activityType":"page","name":"Notes"}}""",
        )
        assertNull(view.body.str("anything"))
        assertTrue(view.body.arr("files").toFileRefs().isEmpty())
        assertNull(view.body.bool("canSubmit"))
    }

    @Test
    fun `a JSON null reads as absent rather than the text null`() {
        val view = envelope("""{ "instance": { "externalUrl": null } }""")
        assertNull(view.body.instance().str("externalUrl"))
    }

    @Test
    fun `capabilities decide what a learner may do, and default to nothing`() {
        val view = json.decodeFromString<ModuleViewEnvelope>(
            """{"module":{"id":"cm1","activityType":"assign","name":"H"},"capabilities":["mod/assign:submit"]}""",
        )
        assertTrue(view.capabilities.contains("mod/assign:submit"))
        assertFalse(view.capabilities.contains("mod/quiz:attempt"))
    }

    @Test
    fun `viewingAs says whether the server thinks a pupil or a guardian is looking`() {
        val view = json.decodeFromString<ModuleViewEnvelope>(
            """{"module":{"id":"cm1","activityType":"quiz","name":"Q"},"viewingAs":{"kind":"guardian","studentProfileId":"sp1"}}""",
        )
        assertEquals("guardian", view.viewingAs.kind)
        assertEquals("sp1", view.viewingAs.studentProfileId)
    }
}
