package com.school.portal.data.repo

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import com.school.portal.data.api.SchoolApi
import com.school.portal.data.model.Attempt
import com.school.portal.data.model.AttendanceStatusOption
import com.school.portal.data.model.ClassRosterPupil
import com.school.portal.data.model.CoursePageView
import com.school.portal.data.model.DueItem
import com.school.portal.data.model.FileRef
import com.school.portal.data.model.LoginRequest
import com.school.portal.data.model.LoginResponse
import com.school.portal.data.model.MarkRegisterEntry
import com.school.portal.data.model.MarkRegisterRequest
import com.school.portal.data.model.MarkSheetRow
import com.school.portal.data.model.ModuleViewEnvelope
import com.school.portal.data.model.MyAssessment
import com.school.portal.data.model.MyCourse
import com.school.portal.data.model.PortalContext
import com.school.portal.data.model.PortalNotice
import com.school.portal.data.model.RecordMarkRequest
import com.school.portal.data.model.RegisterRow
import com.school.portal.data.model.ReleasedGrade
import com.school.portal.data.model.ReportCard
import com.school.portal.data.model.SaveResponseRequest
import com.school.portal.data.model.StartAttemptRequest
import com.school.portal.data.model.StudentDashboard
import com.school.portal.data.model.SubmitAttemptRequest
import com.school.portal.data.model.SubmitMarksRequest
import com.school.portal.data.model.TeacherDashboard
import com.school.portal.data.model.TeacherOverview
import com.school.portal.data.net.ApiResult
import com.school.portal.data.net.AppJson
import com.school.portal.data.net.apiCall
import com.school.portal.data.prefs.SessionStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.asRequestBody
import java.io.File

/**
 * The one place the app talks to the school.
 *
 * Screens get results, never exceptions, and never build a URL of their own.
 * The repository also owns the two decisions that must not be spread across
 * screens: which pupil a request is about (the `asStudent` rule below), and how
 * a session is established or ended.
 */
class PortalRepository(
    private val api: SchoolApi,
    private val session: SessionStore,
    private val appContext: Context,
) {

    /* ── Session ──────────────────────────────────────────────────────────── */

    /**
     * Sign in, then immediately ask the server who this session speaks for.
     *
     * The second call is not optional: nothing in the token tells the app
     * whether it is drawing a pupil's own courses or a guardian's child, and
     * every self-scoped route needs that answer.
     */
    suspend fun signIn(email: String, password: String): ApiResult<LoginResponse> = apiCall {
        val response = api.login(
            LoginRequest(
                organizationCode = session.orgCodeNow(),
                email = email.trim().lowercase(),
                password = password,
            ),
        )
        if (!response.requiresMfa && response.accessToken != null && response.refreshToken != null) {
            session.saveTokens(response.accessToken, response.refreshToken)
            session.saveIdentity(response.user, response.organization, response.permissions)
            runCatching { session.savePortal(api.portalContext()) }
        }
        response
    }

    suspend fun refreshPortalContext(): ApiResult<PortalContext> = apiCall {
        api.portalContext().also { session.savePortal(it) }
    }

    fun signOut() = session.clear()

    /**
     * The pupil a learner-side request is about.
     *
     * A pupil's own token already names them, so the parameter is left off — the
     * server resolves the subject from the token's portal claim. A guardian has
     * to say which child, and the server accepts the id only when that child is
     * actually theirs.
     */
    private fun asStudent(): String? =
        if (session.portal.value?.isGuardian == true) session.activeStudentId.value else null

    /** The pupil whose dashboard to open: the active child, or the pupil themselves. */
    fun subjectStudentId(): String? =
        session.activeStudentId.value ?: session.portal.value?.students?.firstOrNull()?.studentProfileId

    /* ── Notices ──────────────────────────────────────────────────────────── */

    suspend fun notices(): ApiResult<List<PortalNotice>> = apiCall { api.notices(100) }

    suspend fun markNoticeRead(id: String): ApiResult<Unit> = apiCall {
        api.markNoticeRead(id, JsonObject(emptyMap()))
    }

    /* ── Student ──────────────────────────────────────────────────────────── */

    suspend fun studentDashboard(studentProfileId: String): ApiResult<StudentDashboard> =
        apiCall { api.studentDashboard(studentProfileId) }

    suspend fun reportCards(studentProfileId: String): ApiResult<List<ReportCard>> =
        apiCall { api.reportCards(studentProfileId) }

    suspend fun myCourses(): ApiResult<List<MyCourse>> = apiCall { api.myCourses(asStudent()).courses }

    suspend fun dueSoon(days: Int = 14): ApiResult<List<DueItem>> = apiCall {
        unwrapDue(api.dueSoon(asStudent(), days))
    }

    suspend fun myGrades(): ApiResult<List<ReleasedGrade>> = apiCall { api.myGrades(asStudent()) }

    suspend fun coursePage(courseId: String): ApiResult<CoursePageView> =
        apiCall { api.coursePage(courseId, asStudent()) }

    suspend fun moduleView(moduleId: String): ApiResult<ModuleViewEnvelope> =
        apiCall { api.moduleView(moduleId, asStudent()) }

    /** Run a plugin verb. The server re-checks the capability behind it. */
    suspend fun moduleAction(
        moduleId: String,
        action: String,
        body: Map<String, JsonElement> = emptyMap(),
    ): ApiResult<Unit> = apiCall {
        val payload = buildMap {
            putAll(body)
            asStudent()?.let { put("asStudent", JsonPrimitive(it)) }
        }
        api.moduleAction(moduleId, action, JsonObject(payload))
    }

    suspend fun setCompletion(moduleId: String, complete: Boolean): ApiResult<Unit> = apiCall {
        val payload = buildMap {
            put("state", JsonPrimitive(if (complete) "complete" else "incomplete"))
            asStudent()?.let { put("asStudent", JsonPrimitive(it)) }
        }
        api.setCompletion(moduleId, JsonObject(payload))
    }

    /** A short-lived signed URL for a course file or a submission. */
    suspend fun fileUrl(fileId: String): ApiResult<String> = apiCall { api.signFileUrl(fileId).url }

    /**
     * Upload one picked file.
     *
     * Streamed through a cache copy rather than read into memory: pupils attach
     * photographs of handwritten work, and a 12MP JPEG loaded as a ByteArray on
     * a low-end phone is how the app gets killed mid-hand-in.
     */
    suspend fun uploadFile(uri: Uri): ApiResult<FileRef> = apiCall {
        withContext(Dispatchers.IO) {
            val resolver = appContext.contentResolver
            val name = displayName(uri) ?: "upload"
            val mime = resolver.getType(uri) ?: "application/octet-stream"
            val cached = File(appContext.cacheDir, "upload-${System.currentTimeMillis()}-$name")
            resolver.openInputStream(uri)?.use { input ->
                cached.outputStream().use { output -> input.copyTo(output) }
            } ?: error("That file could not be read")
            try {
                val part = MultipartBody.Part.createFormData(
                    "file",
                    name,
                    cached.asRequestBody(mime.toMediaTypeOrNull()),
                )
                val uploaded = api.upload(part)
                FileRef(
                    id = uploaded.id,
                    filename = uploaded.filename ?: uploaded.originalName ?: name,
                    byteSize = uploaded.byteSize ?: cached.length(),
                )
            } finally {
                cached.delete()
            }
        }
    }

    private fun displayName(uri: Uri): String? =
        runCatching {
            appContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
            }
        }.getOrNull()

    /* ── Sitting a quiz ───────────────────────────────────────────────────── */

    /**
     * The DTO requires studentProfileId even though the server substitutes a
     * pupil's own and refuses anyone else's — so it is sent FROM the portal
     * context rather than trusted from it.
     */
    suspend fun startAttempt(paperId: String, studentProfileId: String): ApiResult<Attempt> =
        apiCall { api.startAttempt(StartAttemptRequest(paperId, studentProfileId)) }

    suspend fun attempt(attemptId: String): ApiResult<Attempt> = apiCall { api.attempt(attemptId) }

    suspend fun saveResponse(
        attemptId: String,
        questionId: String,
        response: JsonObject,
        sequenceNumber: Int,
    ): ApiResult<Unit> = apiCall {
        api.saveResponse(
            SaveResponseRequest(
                attemptId = attemptId,
                questionId = questionId,
                response = response,
                sequenceNumber = sequenceNumber,
                clientEventId = "$attemptId:$questionId:$sequenceNumber",
            ),
        )
    }

    suspend fun submitAttempt(attemptId: String): ApiResult<Unit> = apiCall {
        api.submitAttempt(SubmitAttemptRequest(attemptId, idempotencyKey = "submit:$attemptId"))
    }

    /* ── Teacher ──────────────────────────────────────────────────────────── */

    suspend fun teacherDashboard(staffProfileId: String): ApiResult<TeacherDashboard> =
        apiCall { api.teacherDashboard(staffProfileId) }

    suspend fun teacherOverview(staffProfileId: String): ApiResult<TeacherOverview> =
        apiCall { api.teacherOverview(staffProfileId) }

    suspend fun attendanceStatuses(): ApiResult<List<AttendanceStatusOption>> =
        apiCall { api.attendanceStatuses().filter { it.active } }

    suspend fun classRoster(classId: String): ApiResult<List<ClassRosterPupil>> =
        apiCall { api.classRoster(classId) }

    suspend fun register(classId: String, date: String): ApiResult<List<RegisterRow>> =
        apiCall { api.register(classId, date) }

    suspend fun markRegister(
        classId: String,
        date: String,
        entries: List<MarkRegisterEntry>,
    ): ApiResult<Unit> = apiCall {
        api.markRegister(MarkRegisterRequest(classId, date, entries))
    }

    suspend fun myAssessments(): ApiResult<List<MyAssessment>> = apiCall { api.myAssessments() }

    suspend fun markSheet(assessmentId: String): ApiResult<List<MarkSheetRow>> =
        apiCall { api.markSheet(assessmentId) }

    suspend fun recordMark(studentAssessmentId: String, score: Double): ApiResult<Unit> = apiCall {
        api.recordMark(RecordMarkRequest(studentAssessmentId, score))
    }

    suspend fun submitMarks(assessmentId: String): ApiResult<Unit> = apiCall {
        api.submitMarks(SubmitMarksRequest(assessmentId))
    }

    private fun unwrapDue(element: JsonElement): List<DueItem> {
        val array = when (element) {
            is JsonArray -> element
            is JsonObject -> element["items"] as? JsonArray ?: JsonArray(emptyList())
            else -> JsonArray(emptyList())
        }
        return AppJson.decodeFromJsonElement(
            kotlinx.serialization.builtins.ListSerializer(DueItem.serializer()),
            array,
        )
    }
}
