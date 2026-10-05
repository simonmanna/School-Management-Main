package com.school.portal.ui.screens.teacher

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.TeacherDashboard
import com.school.portal.data.model.teachingClasses
import com.school.portal.data.net.ApiError
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.nav.Routes

class TeacherClassesViewModel(repo: PortalRepository, private val staffProfileId: String?) :
    LoadingViewModel<TeacherDashboard>(repo) {
    override suspend fun load(): ApiResult<TeacherDashboard> {
        val staffId = staffProfileId
            ?: return ApiResult.Failed(ApiError(null, "This login is not linked to a staff record."))
        return repo.teacherDashboard(staffId)
    }
}

/**
 * The classes a teacher takes.
 *
 * Built from the teaching ASSIGNMENTS the dashboard returns, collapsed per
 * class and stream — the assignment's own id is not a class id, and treating it
 * as one is what sent the register to an empty roster in the web portal.
 */
@Composable
fun TeacherClassesScreen(container: AppContainer, navController: NavHostController) {
    val portal by container.session.portal.collectAsStateWithLifecycle()
    val staffId = portal?.teacher?.staffProfileId
    val vm = portalViewModel(container, key = "classes-$staffId") { TeacherClassesViewModel(it, staffId) }
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(container, title = "Classes")
        StateBox(state, onRetry = vm::reload) { dashboard ->
            val classes = dashboard.teachingClasses()
            if (classes.isEmpty()) {
                EmptyBox(
                    title = "No classes are assigned to you",
                    hint = "Ask the office to add your teaching assignments.",
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(classes, key = { it.classId + (it.sectionId ?: "") }) { teaching ->
                        SectionCard(
                            Modifier.clickable {
                                navController.navigate(Routes.register(teaching.classId, teaching.name))
                            },
                        ) {
                            Text(teaching.name, style = MaterialTheme.typography.titleMedium)
                            Text(
                                teaching.subjects.joinToString(" · ").ifBlank { "No subject recorded" },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Text(
                                "Take the register",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
    }
}
