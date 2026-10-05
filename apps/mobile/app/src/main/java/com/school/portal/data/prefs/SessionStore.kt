package com.school.portal.data.prefs

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import com.school.portal.BuildConfig
import com.school.portal.data.model.PortalContext
import com.school.portal.data.model.SessionOrganization
import com.school.portal.data.model.SessionUser
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.Json

/**
 * Where the session lives on the device.
 *
 * The two tokens are sealed with a keystore key before they are written (see
 * [SecretBox]): a pupil's phone is shared, rooted, lost and handed round more
 * often than a laptop is, and a bearer token in cleartext on disk is a working
 * login for whoever reads the file. Everything else here — the server URL, the
 * organization code, the cached identity — is not secret and is stored plainly;
 * the whole file is excluded from backup either way (xml/data_extraction_rules).
 *
 * Reads are mirrored into StateFlows so Compose can collect them without
 * touching disk on recomposition, and so the OkHttp authenticator — which runs
 * off the main thread — can read a token without suspending.
 */
class SessionStore(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    private val json = Json { ignoreUnknownKeys = true }

    private val _accessToken = MutableStateFlow(SecretBox.open(prefs.getString(KEY_ACCESS, null)))
    private val _signedIn = MutableStateFlow(SecretBox.open(prefs.getString(KEY_REFRESH, null)) != null)
    private val _user = MutableStateFlow(read<SessionUser>(KEY_USER))
    private val _organization = MutableStateFlow(read<SessionOrganization>(KEY_ORG))
    private val _portal = MutableStateFlow(read<PortalContext>(KEY_PORTAL))
    private val _activeStudentId = MutableStateFlow(prefs.getString(KEY_ACTIVE_STUDENT, null))
    private val _baseUrl = MutableStateFlow(
        prefs.getString(KEY_BASE_URL, null) ?: BuildConfig.DEFAULT_API_BASE_URL,
    )
    private val _orgCode = MutableStateFlow(
        prefs.getString(KEY_ORG_CODE, null) ?: BuildConfig.DEFAULT_ORG_CODE,
    )

    val signedIn: StateFlow<Boolean> = _signedIn.asStateFlow()
    val user: StateFlow<SessionUser?> = _user.asStateFlow()
    val organization: StateFlow<SessionOrganization?> = _organization.asStateFlow()
    val portal: StateFlow<PortalContext?> = _portal.asStateFlow()
    val activeStudentId: StateFlow<String?> = _activeStudentId.asStateFlow()
    val baseUrl: StateFlow<String> = _baseUrl.asStateFlow()
    val orgCode: StateFlow<String> = _orgCode.asStateFlow()

    /** Read synchronously by the request interceptor on an OkHttp thread. */
    fun accessTokenNow(): String? = _accessToken.value

    fun refreshTokenNow(): String? = SecretBox.open(prefs.getString(KEY_REFRESH, null))

    fun baseUrlNow(): String = _baseUrl.value

    fun orgCodeNow(): String = _orgCode.value

    fun saveTokens(access: String, refresh: String) {
        prefs.edit {
            putString(KEY_ACCESS, SecretBox.seal(access))
            putString(KEY_REFRESH, SecretBox.seal(refresh))
        }
        _accessToken.value = access
        _signedIn.value = true
    }

    fun saveIdentity(user: SessionUser?, organization: SessionOrganization?, permissions: List<String>) {
        prefs.edit {
            putString(KEY_USER, user?.let { json.encodeToString(it) })
            putString(KEY_ORG, organization?.let { json.encodeToString(it) })
            putStringSet(KEY_PERMISSIONS, permissions.toSet())
        }
        _user.value = user
        _organization.value = organization
    }

    fun savePortal(portal: PortalContext) {
        prefs.edit { putString(KEY_PORTAL, json.encodeToString(portal)) }
        _portal.value = portal
        // A single-child guardian never sees a picker, so the active child has to
        // be chosen for them or every self-scoped call goes out without a subject.
        if (_activeStudentId.value == null) {
            portal.students.firstOrNull()?.let { setActiveStudent(it.studentProfileId) }
        }
    }

    fun setActiveStudent(studentProfileId: String?) {
        prefs.edit { putString(KEY_ACTIVE_STUDENT, studentProfileId) }
        _activeStudentId.value = studentProfileId
    }

    fun setBaseUrl(url: String) {
        val tidy = url.trim().trimEnd('/')
        prefs.edit { putString(KEY_BASE_URL, tidy) }
        _baseUrl.value = tidy
    }

    fun setOrgCode(code: String) {
        val tidy = code.trim().uppercase()
        prefs.edit { putString(KEY_ORG_CODE, tidy) }
        _orgCode.value = tidy
    }

    /**
     * End the session. The server URL and organization code survive: they are
     * device configuration, and making a parent retype a LAN address every time
     * their token expires is how a school stops using the app.
     */
    fun clear() {
        prefs.edit {
            remove(KEY_ACCESS); remove(KEY_REFRESH); remove(KEY_USER); remove(KEY_ORG)
            remove(KEY_PERMISSIONS); remove(KEY_PORTAL); remove(KEY_ACTIVE_STUDENT)
        }
        _accessToken.value = null
        _signedIn.value = false
        _user.value = null
        _organization.value = null
        _portal.value = null
        _activeStudentId.value = null
    }

    private inline fun <reified T> read(key: String): T? =
        prefs.getString(key, null)?.let { runCatching { json.decodeFromString<T>(it) }.getOrNull() }

    private companion object {
        const val FILE = "school-portal-session"
        const val KEY_ACCESS = "accessToken"
        const val KEY_REFRESH = "refreshToken"
        const val KEY_USER = "user"
        const val KEY_ORG = "organization"
        const val KEY_PERMISSIONS = "permissions"
        const val KEY_PORTAL = "portal"
        const val KEY_ACTIVE_STUDENT = "activeStudentId"
        const val KEY_BASE_URL = "baseUrl"
        const val KEY_ORG_CODE = "orgCode"
    }
}
