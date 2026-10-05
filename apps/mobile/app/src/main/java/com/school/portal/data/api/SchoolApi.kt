package com.school.portal.data.api

import com.school.portal.data.model.Attempt
import com.school.portal.data.model.AttendanceStatusOption
import com.school.portal.data.model.ClassRosterPupil
import com.school.portal.data.model.CoursePageView
import com.school.portal.data.model.LoginRequest
import com.school.portal.data.model.LoginResponse
import com.school.portal.data.model.MarkRegisterRequest
import com.school.portal.data.model.MarkSheetRow
import com.school.portal.data.model.ModuleViewEnvelope
import com.school.portal.data.model.MyAssessment
import com.school.portal.data.model.MyCoursesResponse
import com.school.portal.data.model.PortalContext
import com.school.portal.data.model.PortalNotice
import com.school.portal.data.model.RecordMarkRequest
import com.school.portal.data.model.RegisterRow
import com.school.portal.data.model.ReleasedGrade
import com.school.portal.data.model.ReportCard
import com.school.portal.data.model.SignedUrl
import com.school.portal.data.model.StartAttemptRequest
import com.school.portal.data.model.StudentDashboard
import com.school.portal.data.model.SubmitAttemptRequest
import com.school.portal.data.model.SubmitMarksRequest
import com.school.portal.data.model.SaveResponseRequest
import com.school.portal.data.model.TeacherDashboard
import com.school.portal.data.model.TeacherOverview
import com.school.portal.data.model.UploadedFile
import com.school.portal.data.net.HEADER_NO_AUTH
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Headers
import retrofit2.http.Multipart
import retrofit2.http.POST
import retrofit2.http.Part
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Every endpoint this app talks to.
 *
 * Nothing here is new API surface: these are the same self-scoped routes the web
 * portal calls (apps/portal/src/lib/portal-api.ts). Where a route still takes a
 * studentProfileId in the path, the server re-checks it against the caller's
 * portal claim — so the id this app passes is a request, not a permission.
 */
interface SchoolApi {

    /* ── Session ──────────────────────────────────────────────────────────── */

    @Headers("$HEADER_NO_AUTH: 1")
    @POST("auth/login")
    suspend fun login(@Body body: LoginRequest): LoginResponse

    /** Who this session speaks for. The first call the app makes after login. */
    @GET("school/portals/me")
    suspend fun portalContext(): PortalContext

    @GET("school/portals/notifications")
    suspend fun notices(@Query("limit") limit: Int = 100): List<PortalNotice>

    @POST("school/portals/notifications/{id}/read")
    suspend fun markNoticeRead(@Path("id") id: String, @Body body: JsonObject)

    /* ── Student ──────────────────────────────────────────────────────────── */

    @GET("school/portals/student/{studentProfileId}")
    suspend fun studentDashboard(@Path("studentProfileId") studentProfileId: String): StudentDashboard

    @GET("school/portals/student/{studentProfileId}/report-cards")
    suspend fun reportCards(@Path("studentProfileId") studentProfileId: String): List<ReportCard>

    /* ── My learning (self-scoped; asStudent is re-checked server-side) ───── */

    @GET("school/lms/my/courses")
    suspend fun myCourses(@Query("asStudent") asStudent: String? = null): MyCoursesResponse

    /**
     * Returns a bare array in some versions and `{ items: [...] }` in others,
     * so the repository unwraps it rather than this interface guessing.
     */
    @GET("school/lms/my/due")
    suspend fun dueSoon(
        @Query("asStudent") asStudent: String? = null,
        @Query("days") days: Int = 14,
    ): JsonElement

    @GET("school/lms/my/grades")
    suspend fun myGrades(@Query("asStudent") asStudent: String? = null): List<ReleasedGrade>

    /* ── Course consumption ───────────────────────────────────────────────── */

    @GET("school/lms/courses/{courseId}")
    suspend fun coursePage(
        @Path("courseId") courseId: String,
        @Query("asStudent") asStudent: String? = null,
    ): CoursePageView

    @GET("school/lms/modules/{moduleId}/view")
    suspend fun moduleView(
        @Path("moduleId") moduleId: String,
        @Query("asStudent") asStudent: String? = null,
    ): ModuleViewEnvelope

    /**
     * Run a plugin-defined verb on an activity — submit for homework, post for a
     * forum reply. The action list belongs to the activity's plugin, so the verb
     * travels as data rather than as one route per verb.
     */
    @POST("school/lms/modules/{moduleId}/action/{action}")
    suspend fun moduleAction(
        @Path("moduleId") moduleId: String,
        @Path("action") action: String,
        @Body body: JsonObject,
    )

    @POST("school/lms/modules/{moduleId}/completion")
    suspend fun setCompletion(
        @Path("moduleId") moduleId: String,
        @Body body: JsonObject,
    )

    /**
     * A file id is not authority: the server checks the caller may see this file
     * (a classmate's submission is not course content) before it signs anything,
     * and the URL it hands back expires.
     */
    @POST("school/lms/files/{fileId}/url")
    suspend fun signFileUrl(@Path("fileId") fileId: String): SignedUrl

    @Multipart
    @POST("files/upload")
    suspend fun upload(@Part file: MultipartBody.Part): UploadedFile

    /* ── Sitting a quiz (the CBT engine owns the attempt) ─────────────────── */

    @POST("school/cbt/start")
    suspend fun startAttempt(@Body body: StartAttemptRequest): Attempt

    @GET("school/cbt/attempts/{attemptId}")
    suspend fun attempt(@Path("attemptId") attemptId: String): Attempt

    @POST("school/cbt/response")
    suspend fun saveResponse(@Body body: SaveResponseRequest)

    @POST("school/cbt/submit")
    suspend fun submitAttempt(@Body body: SubmitAttemptRequest)

    /* ── Teacher ──────────────────────────────────────────────────────────── */

    @GET("school/portals/teacher/{staffProfileId}")
    suspend fun teacherDashboard(@Path("staffProfileId") staffProfileId: String): TeacherDashboard

    @GET("school/portals/teaching/{staffProfileId}")
    suspend fun teacherOverview(@Path("staffProfileId") staffProfileId: String): TeacherOverview

    @GET("school/attendance/statuses")
    suspend fun attendanceStatuses(): List<AttendanceStatusOption>

    @GET("school/students/by-class/{classId}")
    suspend fun classRoster(@Path("classId") classId: String): List<ClassRosterPupil>

    @GET("school/attendance/register")
    suspend fun register(
        @Query("classId") classId: String,
        @Query("date") date: String,
    ): List<RegisterRow>

    @POST("school/attendance/mark")
    suspend fun markRegister(@Body body: MarkRegisterRequest)

    @GET("school/marking/mine")
    suspend fun myAssessments(): List<MyAssessment>

    @GET("school/marking/by-assessment/{assessmentId}")
    suspend fun markSheet(@Path("assessmentId") assessmentId: String): List<MarkSheetRow>

    @POST("school/marking/mark")
    suspend fun recordMark(@Body body: RecordMarkRequest)

    /** Hand a finished mark sheet to the approver. Whoever enters does not approve. */
    @POST("school/marking/submit")
    suspend fun submitMarks(@Body body: SubmitMarksRequest)
}
