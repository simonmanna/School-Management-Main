package com.school.portal

import android.content.Context
import com.school.portal.data.api.SchoolApi
import com.school.portal.data.net.HttpFactory
import com.school.portal.data.prefs.SessionStore
import com.school.portal.data.repo.PortalRepository
import okhttp3.OkHttpClient
import retrofit2.create

/**
 * Dependency wiring, by hand.
 *
 * There is no annotation processor here on purpose: this app has exactly one
 * HTTP client, one store and one repository, and a graph that small does not
 * pay for a KSP round in every build — nor for a Gradle/Kotlin/Hilt version
 * triangle that has to be re-solved on every toolchain bump.
 */
class AppContainer(context: Context) {

    val session: SessionStore = SessionStore(context)

    private val client: OkHttpClient = HttpFactory.client(
        session = session,
        // The authenticator has already cleared the session by the time this
        // runs; the UI reacts to `session.signedIn` turning false, so there is
        // nothing to route from here.
        onSessionEnded = {},
    )

    private val api: SchoolApi = HttpFactory.retrofit(client).create()

    val repository: PortalRepository = PortalRepository(api, session, context.applicationContext)
}
