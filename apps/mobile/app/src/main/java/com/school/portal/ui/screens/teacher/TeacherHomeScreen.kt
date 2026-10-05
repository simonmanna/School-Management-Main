package com.school.portal.ui.screens.teacher

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.TeacherDashboard
import com.school.portal.data.model.TeacherOverview
import com.school.portal.data.model.teachingClasses
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.SectionHeader
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.StatTile
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.common.today
import com.school.portal.ui.nav.Routes

data class TeacherHome(val dashboard: TeacherDashboard, val overview: TeacherOverview?)

class TeacherHomeViewModel(repo: PortalRepository, private val staffProfileId: String?) :
    LoadingViewModel<TeacherHome>(repo) {
    override suspend fun load(): ApiResult<TeacherHome> {
        val staffId = staffProfileId
            ?: return ApiResult.Failed(
                com.school.portal.data.net.ApiError(
                    status = null,
                    message = "This login is not linked to a staff record.",
                ),
            )
        return when (val dashboard = repo.teacherDashboard(staffId)) {
            is ApiResult.Failed -> dashboard
            is ApiResult.Ok -> ApiResult.Ok(
                TeacherHome(
                    dashboard = dashboard.value,
                    // The overview is extra context, not the page: a teacher
                    // without the lesson-planning grant still gets their day.
                    overview = (repo.teacherOverview(staffId) as? ApiResult.Ok)?.value,
                ),
            )
        }
    }
}

/**
 * A teacher's day: what they are teaching, what is waiting to be marked, and
 * the fastest way into a register.
 */
@Composable
fun TeacherHomeScreen(container: AppContainer, navController: NavHostController) {
    val portal by container.session.portal.collectAsStateWithLifecycle()
    val staffId = portal?.teacher?.staffProfileId
    val vm = portalViewModel(container, key = "teacher-$staffId") { TeacherHomeViewModel(it, staffId) }
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(
            container = container,
            title = "Today",
            subtitle = portal?.teacher?.name,
        )
        StateBox(state, onRetry = vm::reload) { home ->
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        StatTile(
                            "To approve",
                            home.dashboard.marking.pendingApprovals.toString(),
                            Modifier.weight(1f),
                        )
                        StatTile("Draft marks", home.dashboard.marking.draftMarks.toString(), Modifier.weight(1f))
                        StatTile("Pending", home.dashboard.pendingGradeCount.toString(), Modifier.weight(1f))
                    }
                }

                home.overview?.lessonPlans?.let { plans ->
                    item { SectionHeader("Lesson plans") }
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatTile("Draft", plans.draft.toString(), Modifier.weight(1f))
                            StatTile("Submitted", plans.submitted.toString(), Modifier.weight(1f))
                            StatTile("Approved", plans.approved.toString(), Modifier.weight(1f))
                        }
                    }
                }

                item { SectionHeader("Today's lessons") }
                val schedule = home.dashboard.todaySchedule
                if (schedule.isEmpty()) {
                    item {
                        SectionCard {
                            Text("Nothing timetabled today.", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                } else {
                    item {
                        SectionCard {
                            schedule.forEachIndexed { index, slot ->
                                if (index > 0) HorizontalDivider()
                                Column(Modifier.fillMaxWidth()) {
                                    Text(
                                        listOfNotNull(slot.subject?.name, slot.schoolClass?.name)
                                            .joinToString(" · ")
                                            .ifBlank { "Lesson" },
                                        style = MaterialTheme.typography.bodyLarge,
                                    )
                                    val meta = listOfNotNull(
                                        slot.period?.name,
                                        slot.period?.startTime?.take(5),
                                        slot.room,
                                    ).joinToString(" · ")
                                    if (meta.isNotBlank()) {
                                        Text(
                                            meta,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                item { SectionHeader("Take a register") }
                val classes = home.dashboard.teachingClasses()
                if (classes.isEmpty()) {
                    item {
                        EmptyBox(
                            title = "No classes are assigned to you",
                            hint = "Ask the office to add your teaching assignments.",
                        )
                    }
                } else {
                    items(classes, key = { it.classId + (it.sectionId ?: "") }) { teaching ->
                        SectionCard(
                            Modifier.clickable {
                                navController.navigate(Routes.register(teaching.classId, teaching.name))
                            },
                        ) {
                            Text(teaching.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                            if (teaching.subjects.isNotEmpty()) {
                                Text(
                                    teaching.subjects.joinToString(" · "),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            Text(
                                "Mark for ${com.school.portal.ui.common.formatDayLabel(today())}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }

                val papers = home.overview?.examPapers.orEmpty()
                if (papers.isNotEmpty()) {
                    item { SectionHeader("Exam marks") }
                    items(papers, key = { it.examScheduleId }) { paper ->
                        SectionCard {
                            Text("${paper.examName} · ${paper.subject}", style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "${paper.entered} of ${paper.total} entered",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }
            }
        }
    }
}
