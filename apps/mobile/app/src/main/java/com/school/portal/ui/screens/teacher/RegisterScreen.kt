package com.school.portal.ui.screens.teacher

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBackIos
import androidx.compose.material.icons.automirrored.outlined.ArrowForwardIos
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.AttendanceStatusOption
import com.school.portal.data.model.ClassRosterPupil
import com.school.portal.data.model.MarkRegisterEntry
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.formatDayLabel
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.common.shiftDays
import com.school.portal.ui.common.today
import kotlinx.coroutines.launch

data class RegisterPage(
    val roster: List<ClassRosterPupil>,
    val statuses: List<AttendanceStatusOption>,
    /** studentProfileId to status code, as already recorded for this date. */
    val marked: Map<String, String>,
)

class RegisterViewModel(
    repo: PortalRepository,
    private val classId: String,
) : LoadingViewModel<RegisterPage>(repo) {

    var date by mutableStateOf(today())
        private set

    /** Edits not yet sent. Separate from what the server said, so a failed save is visible. */
    var draft by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    var saving by mutableStateOf(false)
        private set

    override suspend fun load(): ApiResult<RegisterPage> {
        val roster = repo.classRoster(classId)
        if (roster is ApiResult.Failed) return roster
        val statuses = repo.attendanceStatuses()
        if (statuses is ApiResult.Failed) return statuses
        val register = repo.register(classId, date)
        val marked = (register as? ApiResult.Ok)?.value
            ?.associate { it.studentProfileId to it.status }
            .orEmpty()
        draft = emptyMap()
        return ApiResult.Ok(
            RegisterPage(
                roster = (roster as ApiResult.Ok).value,
                statuses = (statuses as ApiResult.Ok).value.sortedBy { it.sortOrder ?: 0 },
                marked = marked,
            ),
        )
    }

    fun moveDate(days: Long) {
        date = shiftDays(date, days)
        reload()
    }

    fun choose(studentProfileId: String, statusCode: String) {
        draft = draft + (studentProfileId to statusCode)
    }

    /**
     * Mark everyone not yet touched as present.
     *
     * The default status is whichever one the SCHOOL flagged as default — not
     * the first in the list and not a hard-coded "PRESENT", because a school
     * that renamed its codes would otherwise have the wrong thing marked.
     */
    fun markRestPresent(page: RegisterPage) {
        val fallback = page.statuses.firstOrNull { it.isDefault == true }
            ?: page.statuses.firstOrNull { it.isPresent == true }
            ?: return
        val filled = page.roster.associate { pupil ->
            pupil.id to (draft[pupil.id] ?: page.marked[pupil.id] ?: fallback.code)
        }
        draft = filled
    }

    fun save(page: RegisterPage) {
        val entries = page.roster.mapNotNull { pupil ->
            val chosen = draft[pupil.id] ?: return@mapNotNull null
            if (chosen == page.marked[pupil.id]) null else MarkRegisterEntry(pupil.id, chosen)
        }
        if (entries.isEmpty()) {
            say("Nothing has changed.")
            return
        }
        viewModelScope.launch {
            saving = true
            when (val result = repo.markRegister(classId, date, entries)) {
                is ApiResult.Ok -> {
                    say("Register saved for ${formatDayLabel(date)}")
                    reload()
                }
                is ApiResult.Failed -> say(result.error.message)
            }
            saving = false
        }
    }
}

/**
 * Taking the register.
 *
 * One tap per pupil, statuses straight from the school's own list. The route
 * behind Save is gated on an `:own` grant and re-checked against the caller's
 * StaffProfile, so the class id this screen sends is a request: a teacher who
 * is not on this class gets a 403 rather than somebody else's register.
 */
@Composable
fun RegisterScreen(
    container: AppContainer,
    navController: NavHostController,
    classId: String,
    className: String,
) {
    val vm = portalViewModel(container, key = "register-$classId") { RegisterViewModel(it, classId) }
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
                title = java.net.URLDecoder.decode(className.ifBlank { "Register" }, "UTF-8"),
                subtitle = formatDayLabel(vm.date),
                onBack = { navController.popBackStack() },
            )

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = { vm.moveDate(-1) }) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBackIos, contentDescription = "Previous day")
                }
                Text(
                    formatDayLabel(vm.date),
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                IconButton(
                    onClick = { vm.moveDate(1) },
                    // A register cannot be taken for a day that has not happened.
                    enabled = vm.date < today(),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowForwardIos, contentDescription = "Next day")
                }
            }

            StateBox(state, onRetry = vm::reload) { page ->
                if (page.roster.isEmpty()) {
                    EmptyBox("No pupils in this class", hint = "The roster is empty for this class.")
                    return@StateBox
                }
                Column(Modifier.fillMaxWidth()) {
                    LazyColumn(
                        modifier = Modifier.weight(1f),
                        contentPadding = PaddingValues(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(page.roster, key = { it.id }) { pupil ->
                            val chosen = vm.draft[pupil.id] ?: page.marked[pupil.id]
                            SectionCard {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text(pupil.name, style = MaterialTheme.typography.bodyLarge)
                                        Text(
                                            pupil.admissionNo,
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    if (chosen != null && vm.draft[pupil.id] == null) {
                                        Text(
                                            "saved",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                    items(page.statuses, key = { it.id }) { status ->
                                        FilterChip(
                                            selected = chosen == status.code,
                                            onClick = { vm.choose(pupil.id, status.code) },
                                            label = { Text(status.label.ifBlank { status.code }) },
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Row(
                        Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Button(
                            onClick = { vm.markRestPresent(page) },
                            enabled = !vm.saving,
                            modifier = Modifier.weight(1f).height(50.dp),
                        ) { Text("All present") }
                        Button(
                            onClick = { vm.save(page) },
                            enabled = !vm.saving && vm.draft.isNotEmpty(),
                            modifier = Modifier.weight(1f).height(50.dp),
                        ) {
                            Text(
                                if (vm.saving) "Saving…" else "Save",
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }
                }
            }
        }
    }
}
