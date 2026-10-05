package com.school.portal.ui.screens.student

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.AttendanceSummary
import com.school.portal.data.model.DueItem
import com.school.portal.data.model.StudentDashboard
import com.school.portal.data.model.TimetableSlot
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.SectionHeader
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.StatTile
import com.school.portal.ui.common.formatDue
import com.school.portal.ui.common.plainText
import com.school.portal.ui.common.todayDayOfWeek
import com.school.portal.ui.nav.Routes
import com.school.portal.ui.theme.PortalColors

/** Everything the home screen draws, fetched together. */
data class StudentHome(
    val dashboard: StudentDashboard?,
    val due: List<DueItem>,
)

class StudentHomeViewModel(repo: PortalRepository) : LoadingViewModel<StudentHome>(repo) {
    override suspend fun load(): ApiResult<StudentHome> {
        val studentId = repo.subjectStudentId()
        // A pupil's own token names them; a guardian with no child selected has
        // nothing to ask about yet, which is a legitimate empty rather than an
        // error, so the dashboard half is simply left out.
        val dashboard = studentId?.let { repo.studentDashboard(it) }
        val due = repo.dueSoon(days = 14)
        return when {
            due is ApiResult.Failed && dashboard is ApiResult.Failed -> dashboard
            else -> ApiResult.Ok(
                StudentHome(
                    dashboard = (dashboard as? ApiResult.Ok)?.value,
                    due = (due as? ApiResult.Ok)?.value ?: emptyList(),
                ),
            )
        }
    }
}

/**
 * What a pupil needs on opening the app: what is due, how today looks, and
 * where attendance stands.
 *
 * Marks are deliberately not here. The dashboard's grades come off the
 * assessment spine already filtered to approved marks, and they live on the
 * Marks tab where the full released list is — repeating a partial copy on the
 * home screen is how a pupil comes to believe a mark was withdrawn.
 */
@Composable
fun StudentHomeScreen(container: AppContainer, navController: NavHostController) {
    val vm = com.school.portal.ui.common.portalViewModel(container) { StudentHomeViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val activeStudent by container.session.activeStudentId.collectAsStateWithLifecycle()

    // Switching child re-asks the server; nothing is derived from the old answer.
    androidx.compose.runtime.LaunchedEffect(activeStudent) { vm.reload() }

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(container, title = "Home")
        StateBox(state, onRetry = vm::reload) { home ->
            val profile = home.dashboard?.profile
            LazyColumn(
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item {
                    Text(
                        text = profile?.partner?.name?.ifBlank { null } ?: "Your learning",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                    )
                    val classLine = listOfNotNull(
                        profile?.currentClass?.name,
                        profile?.currentSection?.name,
                        profile?.admissionNo?.let { "No. $it" },
                    ).joinToString(" · ")
                    if (classLine.isNotBlank()) {
                        Text(
                            classLine,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                item { AttendanceTiles(home.dashboard?.attendance ?: AttendanceSummary()) }

                item { SectionHeader("To do") }
                if (home.due.isEmpty()) {
                    item {
                        SectionCard {
                            Text("Nothing is due in the next two weeks.", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                } else {
                    items(home.due, key = { it.id }) { item ->
                        DueRow(item) {
                            val courseId = item.courseId
                            if (courseId != null) {
                                navController.navigate(Routes.module(courseId, item.id))
                            }
                        }
                    }
                }

                val todaySlots = home.dashboard?.timetable
                    ?.filter { it.dayOfWeek == todayDayOfWeek() }
                    ?.sortedBy { it.period?.startTime ?: "" }
                    .orEmpty()
                if (todaySlots.isNotEmpty()) {
                    item { SectionHeader("Today") }
                    item { TimetableCard(todaySlots) }
                }

                val notices = home.dashboard?.announcements.orEmpty()
                if (notices.isNotEmpty()) {
                    item { SectionHeader("From the school") }
                    items(notices.take(3), key = { it.id }) { notice ->
                        SectionCard {
                            Text(notice.title, style = MaterialTheme.typography.titleSmall)
                            Text(
                                notice.body.plainText(),
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 4,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AttendanceTiles(attendance: AttendanceSummary) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        // rate is null when it depends on a late policy the school has not
        // chosen. Saying so beats inventing a percentage the office would deny.
        StatTile(
            label = "Attendance",
            value = attendance.rate?.let { "${it.toInt()}%" } ?: "—",
            modifier = Modifier.weight(1f),
            tint = if ((attendance.rate ?: 100.0) < 80) MaterialTheme.colorScheme.error else null,
        )
        StatTile("Present", attendance.present.toString(), Modifier.weight(1f), PortalColors.success)
        StatTile("Absent", attendance.absent.toString(), Modifier.weight(1f))
    }
}

@Composable
private fun DueRow(item: DueItem, onOpen: () -> Unit) {
    SectionCard(Modifier.clickable(onClick = onOpen)) {
        Text(item.name, style = MaterialTheme.typography.titleSmall)
        Text(
            listOfNotNull(activityLabel(item.activityType), item.courseName).joinToString(" · "),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        val due = formatDue(item.dueAt)
        if (due != null) {
            Text(
                text = "Due $due",
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.SemiBold,
                color = if (item.overdue) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun TimetableCard(slots: List<TimetableSlot>) {
    SectionCard {
        slots.forEachIndexed { index, slot ->
            if (index > 0) HorizontalDivider()
            Row(
                Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Outlined.Schedule,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Column(Modifier.weight(1f)) {
                    Text(slot.subject?.name ?: "Lesson", style = MaterialTheme.typography.bodyLarge)
                    val when_ = listOfNotNull(
                        slot.period?.name,
                        slot.period?.startTime?.take(5),
                        slot.room,
                    ).joinToString(" · ")
                    if (when_.isNotBlank()) {
                        Text(
                            when_,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** Nothing to show for a session with no pupil attached. */
@Composable
fun NoPupil() {
    EmptyBox(
        title = "No pupil is linked to this account",
        hint = "Ask the school office to link your child to your portal login.",
    )
}
