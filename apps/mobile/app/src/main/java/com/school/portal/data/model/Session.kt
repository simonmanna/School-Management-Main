package com.school.portal.data.model

import kotlinx.serialization.Serializable

/**
 * Session shapes, mirroring apps/portal/src/stores/auth.store.ts.
 *
 * Every field the server may omit is nullable or defaulted. A phone build that
 * throws on an unexpected null is a crash in a classroom, where the web portal
 * would only have drawn an empty box.
 */

@Serializable
data class LoginRequest(
    val organizationCode: String,
    val email: String,
    val password: String,
)

@Serializable
data class SessionUser(
    val id: String = "",
    val email: String = "",
    val firstName: String = "",
    val lastName: String? = null,
    val roles: List<String> = emptyList(),
) {
    val displayName: String
        get() = listOfNotNull(firstName.ifBlank { null }, lastName)
            .joinToString(" ")
            .ifBlank { email }
}

@Serializable
data class SessionOrganization(
    val id: String = "",
    val code: String = "",
    val name: String = "",
    val currencyCode: String = "UGX",
    val timezone: String? = null,
)

/**
 * POST /auth/login. A staff account with TOTP enrolled answers with requiresMfa
 * instead of tokens, which the login screen reports rather than failing
 * silently — the same choice the web portal makes.
 */
@Serializable
data class LoginResponse(
    val accessToken: String? = null,
    val refreshToken: String? = null,
    val user: SessionUser? = null,
    val permissions: List<String> = emptyList(),
    val organization: SessionOrganization? = null,
    val requiresMfa: Boolean = false,
    val mfaToken: String? = null,
)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class RefreshResponse(val accessToken: String, val refreshToken: String)

/** One pupil this session may open. */
@Serializable
data class PortalStudent(
    val studentProfileId: String,
    val name: String = "",
    val admissionNo: String? = null,
    val classId: String? = null,
    val className: String? = null,
)

@Serializable
data class PortalTeacher(
    val staffProfileId: String,
    val partnerId: String? = null,
    val name: String = "",
)

/**
 * GET school/portals/me — who the server says this session is.
 *
 * Cached for drawing a name and a child picker only. It is never an
 * authorization input: the API re-checks every request against the token's own
 * portal claim, so what this device holds changes what it draws and nothing
 * about what the server will hand over.
 */
@Serializable
data class PortalContext(
    val kind: String = "student",
    val students: List<PortalStudent> = emptyList(),
    val teacher: PortalTeacher? = null,
    val defaultLanding: String? = null,
) {
    val isGuardian: Boolean get() = kind == "guardian"
    val isStaff: Boolean get() = kind == "staff"
}

@Serializable
data class PortalNotice(
    val id: String,
    val channel: String = "",
    val category: String = "",
    val title: String = "",
    val body: String = "",
    val status: String = "",
    val readAt: String? = null,
    val sentAt: String? = null,
    val createdAt: String? = null,
)

@Serializable
data class UploadedFile(
    val id: String,
    val filename: String? = null,
    val originalName: String? = null,
    val contentType: String? = null,
    val byteSize: Long? = null,
)

@Serializable
data class SignedUrl(val url: String, val filename: String? = null)

/** The reference an activity action expects for an attachment. */
data class FileRef(
    val id: String,
    val filename: String,
    val byteSize: Long? = null,
)
