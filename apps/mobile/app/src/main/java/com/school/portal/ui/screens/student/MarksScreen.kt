package com.school.portal.ui.screens.student

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.school.portal.AppContainer
import com.school.portal.data.model.PublishedResult
import com.school.portal.data.model.ReleasedGrade
import com.school.portal.data.model.ReportCard
import com.school.portal.data.model.StudentDashboard
import com.school.portal.data.model.tidy
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.SectionHeader
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.StatTile
import com.school.portal.ui.common.formatDate
import com.school.portal.ui.common.formatRelative
import com.school.portal.ui.common.portalViewModel

data class MarksPage(
    val released: List<ReleasedGrade>,
    val dashboard: StudentDashboard?,
    val reportCards: List<ReportCard>,
)

class MarksViewModel(repo: PortalRepository) : LoadingViewModel<MarksPage>(repo) {
    override suspend fun load(): ApiResult<MarksPage> {
        val studentId = repo.subjectStudentId()
        val released = repo.myGrades()
        val dashboard = studentId?.let { repo.studentDashboard(it) }
        val reportCards = studentId?.let { repo.reportCards(it) }
        if (released is ApiResult.Failed && dashboard !is ApiResult.Ok) return released
        return ApiResult.Ok(
            MarksPage(
                released = (released as? ApiResult.Ok)?.value ?: emptyList(),
                dashboard = (dashboard as? ApiResult.Ok)?.value,
                reportCards = (reportCards as? ApiResult.Ok)?.value ?: emptyList(),
            ),
        )
    }
}

/**
 * Marks, term results and attendance.
 *
 * Only released marks reach this screen: the server returns APPROVED marks past
 * their release date and withholds the rest, and term results are only in
 * `publishedResults` once the school has published them. Nothing here is
 * recomputed on the device — a portal that derives its own figures is how it
 * comes to contradict the report card.
 */
@Composable
fun MarksScreen(container: AppContainer) {
    val vm = portalViewModel(container) { MarksViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()
    val activeStudent by container.session.activeStudentId.collectAsStateWithLifecycle()

    LaunchedEffect(activeStudent) { vm.reload() }

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(container, title = "Marks")
        StateBox(state, onRetry = vm::reload) { page ->
            LazyColumn(
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val attendance = page.dashboard?.attendance
                if (attendance != null) {
                    item { SectionHeader("Attendance") }
                    item {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            StatTile(
                                "Rate",
                                attendance.rate?.let { "${it.toInt()}%" } ?: "—",
                                Modifier.weight(1f),
                            )
                            StatTile("Present", attendance.present.toString(), Modifier.weight(1f))
                            StatTile("Late", attendance.late.toString(), Modifier.weight(1f))
                            StatTile("Absent", attendance.absent.toString(), Modifier.weight(1f))
                        }
                    }
                    if (attendance.policyMissing) {
                        item {
                            Text(
                                "The school has not set how lateness counts, so no rate is shown.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                }

                val results = page.dashboard?.publishedResults.orEmpty()
                if (results.isNotEmpty()) {
                    item { SectionHeader("Term results") }
                    items(results, key = { it.termId + it.resultSetRevision }) { ResultCard(it) }
                }

                if (page.reportCards.isNotEmpty()) {
                    item { SectionHeader("Report cards") }
                    items(page.reportCards, key = { it.id }) { card ->
                        SectionCard {
                            Text(card.termName ?: "Report card", style = MaterialTheme.typography.titleSmall)
                            Text(
                                "Released ${formatDate(card.publishedAt ?: card.generatedAt)}",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            card.classTeacherComment?.let {
                                Text(it, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                    }
                }

                item { SectionHeader("Recent marks") }
                if (page.released.isEmpty()) {
                    item {
                        EmptyBox(
                            title = "No marks have been released yet",
                            hint = "A mark appears here once your teacher has approved it.",
                        )
                    }
                } else {
                    items(page.released, key = { it.assessmentId + (it.at ?: "") }) { grade ->
                        SectionCard {
                            Row(Modifier.fillMaxWidth()) {
                                Column(Modifier.weight(1f)) {
                                    Text(grade.title, style = MaterialTheme.typography.bodyLarge)
                                    Text(
                                        formatRelative(grade.at),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                                Column {
                                    Text(
                                        "${grade.score?.tidy() ?: "—"} / ${grade.maxScore.tidy()}",
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.Bold,
                                    )
                                    grade.percentage?.let {
                                        Text(
                                            "${it.toInt()}%",
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
        }
    }
}

@Composable
private fun ResultCard(result: PublishedResult) {
    SectionCard {
        Text(
            "Revision ${result.resultSetRevision}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            result.division?.let { StatTile("Division", it, Modifier.weight(1f)) }
            result.aggregate?.let { StatTile("Aggregate", it.toString(), Modifier.weight(1f)) }
            result.meanPercent?.let { StatTile("Mean", "$it%", Modifier.weight(1f)) }
            result.classRank?.let { StatTile("Position", it.toString(), Modifier.weight(1f)) }
        }
        result.promotionRecommendation?.let {
            Text(it, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
