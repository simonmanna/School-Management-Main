package com.school.portal.ui.screens.student

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.CourseModuleView
import com.school.portal.data.model.CoursePageView
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.ProgressRow
import com.school.portal.ui.common.RichText
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.SectionHeader
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.formatDue
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.nav.Routes
import com.school.portal.ui.theme.PortalColors

class CourseViewModel(repo: PortalRepository, private val courseId: String) :
    LoadingViewModel<CoursePageView>(repo) {
    override suspend fun load(): ApiResult<CoursePageView> = repo.coursePage(courseId)
}

/**
 * One course: its sections, and the activities in them.
 *
 * Availability, completion and grades all arrive resolved from the server. A
 * greyed activity is still shown rather than hidden — "opens on Monday" is
 * information a pupil needs, and hiding it is what makes a learner think work
 * has gone missing.
 */
@Composable
fun CourseScreen(
    container: AppContainer,
    navController: NavHostController,
    courseId: String,
) {
    val vm = portalViewModel(container, key = "course-$courseId") { CourseViewModel(it, courseId) }
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(
            container = container,
            title = state.let { (it as? com.school.portal.ui.common.ScreenState.Ready)?.value?.course?.name }
                ?: "Course",
            onBack = { navController.popBackStack() },
        )
        StateBox(state, onRetry = vm::reload) { page ->
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    val line = listOfNotNull(page.course.subject, page.course.className, page.course.term)
                        .joinToString(" · ")
                    if (line.isNotBlank()) {
                        Text(
                            line,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    val progress = page.progress
                    if (progress != null && page.course.completionEnabled) {
                        ProgressRow(
                            percent = progress.percent,
                            label = "${progress.completed} of ${progress.tracked} done",
                        )
                    }
                }

                page.course.summary?.takeIf { it.isNotBlank() }?.let { summary ->
                    item { SectionCard { RichText(summary) } }
                }

                if (page.sections.isEmpty()) {
                    item {
                        EmptyBox(
                            title = "This course has nothing in it yet",
                            hint = "Your teacher has not added any activities.",
                        )
                    }
                }

                page.sections.filter { it.visible }.forEach { section ->
                    item {
                        SectionHeader(
                            section.name?.takeIf { it.isNotBlank() } ?: "Topic ${section.sectionNo}",
                        )
                    }
                    section.summary?.takeIf { it.isNotBlank() }?.let { summary ->
                        item { SectionCard { RichText(summary) } }
                    }
                    if (section.modules.none { it.visible }) {
                        item {
                            SectionCard {
                                Text(
                                    "Nothing here yet.",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                    section.modules.filter { it.visible }.sortedBy { it.sequence }.forEach { module ->
                        item {
                            ModuleRow(module) {
                                navController.navigate(Routes.module(courseId, module.id))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ModuleRow(module: CourseModuleView, onOpen: () -> Unit) {
    val blocked = module.availability?.available == false
    val done = module.completion?.done == true
    SectionCard(Modifier.clickable(onClick = onOpen)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(
                imageVector = if (blocked) Icons.Outlined.Lock else activityIcon(module.activityType),
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Column(Modifier.weight(1f)) {
                Text(module.name, style = MaterialTheme.typography.bodyLarge)
                val meta = buildList {
                    add(activityLabel(module.activityType))
                    formatDue(module.dueAt)?.let { add("due $it") }
                    if (blocked) {
                        val reason = module.availability.reasons.firstOrNull()
                        add(reason ?: "not open yet")
                    }
                }.joinToString(" · ")
                Text(
                    meta,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (done) {
                Icon(
                    Icons.Outlined.CheckCircle,
                    contentDescription = "Done",
                    tint = PortalColors.success,
                    modifier = Modifier.padding(start = 4.dp).size(20.dp),
                )
            }
        }
    }
}
