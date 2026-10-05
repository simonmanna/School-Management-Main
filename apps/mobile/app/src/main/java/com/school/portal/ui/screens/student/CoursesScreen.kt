package com.school.portal.ui.screens.student

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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.MyCourse
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.ProgressRow
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.nav.Routes

class CoursesViewModel(repo: PortalRepository) : LoadingViewModel<List<MyCourse>>(repo) {
    override suspend fun load(): ApiResult<List<MyCourse>> = repo.myCourses()
}

/**
 * The courses this learner is enrolled on.
 *
 * `progress.percent` is the server's figure, computed from tracked completions;
 * the app never derives its own, which is what stopped the web portal from
 * showing a different number than the staff app for the same course.
 */
@Composable
fun CoursesScreen(container: AppContainer, navController: NavHostController) {
    val vm = portalViewModel(container) { CoursesViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val activeStudent by container.session.activeStudentId.collectAsStateWithLifecycle()

    LaunchedEffect(activeStudent) { vm.reload() }

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(container, title = "Courses")
        StateBox(state, onRetry = vm::reload) { courses ->
            if (courses.isEmpty()) {
                EmptyBox(
                    title = "No courses yet",
                    hint = "Courses appear here once your teachers publish them.",
                )
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    items(courses, key = { it.id }) { course ->
                        SectionCard(
                            Modifier.clickable { navController.navigate(Routes.course(course.id)) },
                        ) {
                            Text(course.name, style = MaterialTheme.typography.titleMedium)
                            val line = listOfNotNull(course.subject, course.className, course.term)
                                .joinToString(" · ")
                            if (line.isNotBlank()) {
                                Text(
                                    line,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            if (course.completionEnabled) {
                                ProgressRow(
                                    percent = course.progress.percent,
                                    label = "${course.progress.completed} of ${course.progress.tracked} done",
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
