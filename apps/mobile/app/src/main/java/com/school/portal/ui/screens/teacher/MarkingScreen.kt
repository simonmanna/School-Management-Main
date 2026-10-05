package com.school.portal.ui.screens.teacher

import androidx.compose.foundation.clickable
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.MyAssessment
import com.school.portal.data.model.tidyOrDash
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.ProgressRow
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.formatDue
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.nav.Routes

class MarkingViewModel(repo: PortalRepository) : LoadingViewModel<List<MyAssessment>>(repo) {
    override suspend fun load(): ApiResult<List<MyAssessment>> = repo.myAssessments()
}

/**
 * What this teacher has to mark.
 *
 * The list comes from `school/marking/mine`, which resolves ownership on the
 * server — the app does not filter anybody's assessments, it only draws the
 * ones it was given.
 */
@Composable
fun MarkingScreen(container: AppContainer, navController: NavHostController) {
    val vm = portalViewModel(container) { MarkingViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(container, title = "Marking")
        StateBox(state, onRetry = vm::reload) { assessments ->
            if (assessments.isEmpty()) {
                EmptyBox("Nothing to mark", hint = "Assessments you own appear here.")
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(assessments, key = { it.id }) { assessment ->
                        SectionCard(
                            Modifier.clickable {
                                navController.navigate(Routes.markSheet(assessment.id, assessment.title))
                            },
                        ) {
                            Text(assessment.title, style = MaterialTheme.typography.titleSmall)
                            Text(
                                listOfNotNull(
                                    assessment.subjectName,
                                    listOfNotNull(assessment.className, assessment.sectionName)
                                        .joinToString(" ")
                                        .ifBlank { null },
                                    assessment.termName,
                                ).joinToString(" · "),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text(
                                    "Out of ${assessment.maxScore.tidyOrDash()}",
                                    style = MaterialTheme.typography.bodySmall,
                                )
                                formatDue(assessment.dueAt)?.let {
                                    Text("· due $it", style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            if (assessment.total > 0) {
                                ProgressRow(
                                    percent = (assessment.entered * 100) / assessment.total,
                                    label = "${assessment.entered} of ${assessment.total} entered · " +
                                        "${assessment.approved} approved",
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
