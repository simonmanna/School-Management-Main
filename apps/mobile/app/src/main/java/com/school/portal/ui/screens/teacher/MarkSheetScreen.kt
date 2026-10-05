package com.school.portal.ui.screens.teacher

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.MarkSheetRow
import com.school.portal.data.model.tidy
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.portalViewModel
import kotlinx.coroutines.launch

class MarkSheetViewModel(repo: PortalRepository, private val assessmentId: String) :
    LoadingViewModel<List<MarkSheetRow>>(repo) {

    var busy by mutableStateOf(false)
        private set

    override suspend fun load(): ApiResult<List<MarkSheetRow>> = repo.markSheet(assessmentId)

    /**
     * Record one mark as a draft.
     *
     * Entry and approval are separate steps on the server (whoever enters does
     * not approve), so this writes a draft and nothing else; the figure a
     * family sees does not move until an approver acts.
     */
    fun record(row: MarkSheetRow, score: Double) {
        viewModelScope.launch {
            busy = true
            when (val result = repo.recordMark(row.id, score)) {
                is ApiResult.Ok -> reload()
                is ApiResult.Failed -> say(result.error.message)
            }
            busy = false
        }
    }

    /** Hand the finished sheet to the approver. */
    fun submitSheet() {
        viewModelScope.launch {
            busy = true
            when (val result = repo.submitMarks(assessmentId)) {
                is ApiResult.Ok -> {
                    say("Sent for approval")
                    reload()
                }
                is ApiResult.Failed -> say(result.error.message)
            }
            busy = false
        }
    }
}

/**
 * Entering marks on a phone.
 *
 * One row per pupil with a numeric field, because a teacher marking thirty
 * scripts wants the keypad and nothing else. The mark is sent when the field
 * loses focus rather than on every keystroke, so a two-digit score is one
 * request and not two.
 */
@Composable
fun MarkSheetScreen(
    container: AppContainer,
    navController: NavHostController,
    assessmentId: String,
    title: String,
) {
    val vm = portalViewModel(container, key = "marksheet-$assessmentId") {
        MarkSheetViewModel(it, assessmentId)
    }
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.messageShown()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.padding(padding).fillMaxWidth()) {
            PortalTopBar(
                container = container,
                title = java.net.URLDecoder.decode(title.ifBlank { "Mark sheet" }, "UTF-8"),
                onBack = { navController.popBackStack() },
            )
            StateBox(state, onRetry = vm::reload) { rows ->
                if (rows.isEmpty()) {
                    EmptyBox("Nobody is entered for this assessment")
                    return@StateBox
                }
                Column(Modifier.fillMaxWidth()) {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(rows, key = { it.id }) { row -> MarkRow(row, vm) }
                    }
                    Button(
                        onClick = vm::submitSheet,
                        enabled = !vm.busy,
                        modifier = Modifier.fillMaxWidth().padding(16.dp).height(50.dp),
                    ) { Text(if (vm.busy) "Working…" else "Send for approval") }
                }
            }
        }
    }
}

@Composable
private fun MarkRow(row: MarkSheetRow, vm: MarkSheetViewModel) {
    var text by remember(row.id, row.effectiveScore) {
        mutableStateOf(row.effectiveScore?.tidy().orEmpty())
    }
    val max = row.maxScore
    val invalid = text.toDoubleOrNull()?.let { entered -> max != null && entered > max } == true

    SectionCard {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(row.studentName ?: row.admissionNo ?: "Pupil", style = MaterialTheme.typography.bodyLarge)
                Text(
                    listOfNotNull(
                        row.admissionNo,
                        row.approvalStatus.lowercase().ifBlank { null },
                        row.participation.lowercase().ifBlank { null },
                    ).joinToString(" · "),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            OutlinedTextField(
                value = text,
                onValueChange = { text = it.filter { ch -> ch.isDigit() || ch == '.' } },
                label = { Text("of ${max?.tidy() ?: "?"}") },
                singleLine = true,
                isError = invalid,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                modifier = Modifier.width(120.dp),
            )
            Button(
                onClick = {
                    val score = text.toDoubleOrNull()
                    if (score == null) {
                        vm.say("Enter a number.")
                    } else if (invalid) {
                        // The server rejects this too; refusing here saves the
                        // teacher a round trip in a room with bad signal.
                        vm.say("That is more than the paper is out of.")
                    } else {
                        vm.record(row, score)
                    }
                },
                enabled = !vm.busy && text.isNotBlank(),
                modifier = Modifier.padding(start = 8.dp),
            ) { Text("Save") }
        }
    }
}
