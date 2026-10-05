package com.school.portal.ui.screens.student

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Download
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.RadioButtonUnchecked
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.core.net.toUri
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.Caps
import com.school.portal.data.model.FileRef
import com.school.portal.data.model.GradeDisplay
import com.school.portal.data.model.ModuleViewEnvelope
import com.school.portal.data.model.arr
import com.school.portal.data.model.bool
import com.school.portal.data.model.can
import com.school.portal.data.model.describe
import com.school.portal.data.model.instance
import com.school.portal.data.model.int
import com.school.portal.data.model.obj
import com.school.portal.data.model.str
import com.school.portal.data.model.strings
import com.school.portal.data.model.toFileRef
import com.school.portal.data.model.toFileRefs
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.RichText
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.ScreenState
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.formatBytes
import com.school.portal.ui.common.formatDue
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.nav.Routes
import com.school.portal.ui.theme.PortalColors
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive

class ModuleViewModel(repo: PortalRepository, private val moduleId: String) :
    LoadingViewModel<ModuleViewEnvelope>(repo) {

    var busy by androidx.compose.runtime.mutableStateOf(false)
        private set

    /** Files the learner has attached but not handed in yet. */
    var attachments by androidx.compose.runtime.mutableStateOf<List<FileRef>>(emptyList())
        private set

    override suspend fun load(): ApiResult<ModuleViewEnvelope> = repo.moduleView(moduleId)

    fun attach(uri: Uri) {
        viewModelScope.launch {
            busy = true
            when (val result = repo.uploadFile(uri)) {
                is ApiResult.Ok -> attachments = attachments + result.value
                is ApiResult.Failed -> say(result.error.message)
            }
            busy = false
        }
    }

    fun removeAttachment(id: String) {
        attachments = attachments.filterNot { it.id == id }
    }

    /** Hand in. The server re-checks the capability, the window and the attempt count. */
    fun handIn(text: String) {
        viewModelScope.launch {
            busy = true
            val body = mapOf(
                "content" to JsonPrimitive(text),
                "attachments" to JsonArray(attachments.map { JsonPrimitive(it.id) }),
            )
            when (val result = repo.moduleAction(moduleId, "submit", body)) {
                is ApiResult.Ok -> {
                    attachments = emptyList()
                    say("Sent to your teacher")
                    reload()
                }
                is ApiResult.Failed -> say(result.error.message)
            }
            busy = false
        }
    }

    fun toggleCompletion(done: Boolean) {
        viewModelScope.launch {
            busy = true
            when (val result = repo.setCompletion(moduleId, !done)) {
                is ApiResult.Ok -> reload()
                is ApiResult.Failed -> say(result.error.message)
            }
            busy = false
        }
    }

    /** Ask for a signed URL, then hand the download to the system browser. */
    fun openFile(fileId: String, onUrl: (String) -> Unit) {
        viewModelScope.launch {
            busy = true
            when (val result = repo.fileUrl(fileId)) {
                is ApiResult.Ok -> onUrl(result.value)
                is ApiResult.Failed -> say(result.error.message)
            }
            busy = false
        }
    }
}

/**
 * One activity, as a learner.
 *
 * Chrome once, body by activity type. The staff app dispatches eighteen plugin
 * components; a pupil meets a much smaller set, so this renders the content and
 * hand-in types directly and falls back to the teacher's intro text for
 * anything else rather than pretending to support it.
 *
 * Everything that decides what MAY happen is server-side: canSubmit,
 * availability, attempt counts and the grade all arrive resolved, and the server
 * re-checks on submit. This screen mirrors those answers so a form can be
 * disabled early; it never grants anything.
 */
@Composable
fun ModuleScreen(
    container: AppContainer,
    navController: NavHostController,
    courseId: String,
    moduleId: String,
) {
    val vm = portalViewModel(container, key = "module-$moduleId") { ModuleViewModel(it, moduleId) }
    val state by vm.state.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val context = LocalContext.current

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.messageShown()
        }
    }

    val openUrl: (String) -> Unit = { url ->
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
        }.onFailure { vm.say("Nothing on this phone can open that file.") }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.padding(padding).fillMaxWidth()) {
            PortalTopBar(
                container = container,
                title = (state as? ScreenState.Ready)?.value?.module?.name ?: "Activity",
                subtitle = (state as? ScreenState.Ready)?.value?.course?.name,
                onBack = { navController.popBackStack() },
            )
            StateBox(state, onRetry = vm::reload) { view ->
                val module = view.module
                val blocked = module.availability?.available == false
                val isLearner = view.viewingAs.kind == "student"

                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    item {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Icon(activityIcon(module.activityType), contentDescription = null)
                            Text(
                                activityLabel(module.activityType),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        formatDue(module.dueAt)?.let { due ->
                            Text(
                                "Due $due",
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.SemiBold,
                            )
                        }
                    }

                    if (blocked) {
                        item {
                            SectionCard {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                                ) {
                                    Icon(Icons.Outlined.Lock, contentDescription = null)
                                    Column {
                                        Text("Not open yet", style = MaterialTheme.typography.titleSmall)
                                        val reasons = module.availability.reasons
                                        if (reasons.isNotEmpty()) {
                                            Text(
                                                reasons.joinToString(" · "),
                                                style = MaterialTheme.typography.bodySmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        item {
                            ActivityBody(
                                view = view,
                                vm = vm,
                                isLearner = isLearner,
                                onOpenFile = { id -> vm.openFile(id, openUrl) },
                                onOpenUrl = openUrl,
                                onSitQuiz = { navController.navigate(Routes.quiz(moduleId)) },
                            )
                        }
                        item { GradeCard(view) }
                        if (module.completion?.manual == true && isLearner) {
                            item {
                                val done = module.completion.done
                                OutlinedButton(
                                    onClick = { vm.toggleCompletion(done) },
                                    enabled = !vm.busy,
                                    modifier = Modifier.fillMaxWidth().height(50.dp),
                                ) {
                                    Icon(
                                        if (done) Icons.Outlined.CheckCircle else Icons.Outlined.RadioButtonUnchecked,
                                        contentDescription = null,
                                        tint = if (done) PortalColors.success else MaterialTheme.colorScheme.onSurface,
                                    )
                                    Text(
                                        if (done) "  Done — tap to undo" else "  Mark as done",
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

@Composable
private fun ActivityBody(
    view: ModuleViewEnvelope,
    vm: ModuleViewModel,
    isLearner: Boolean,
    onOpenFile: (String) -> Unit,
    onOpenUrl: (String) -> Unit,
    onSitQuiz: () -> Unit,
) {
    val instance = view.body.instance()
    when (view.module.activityType) {
        "page", "label", "lesson", "book" -> {
            val html = instance.str("content") ?: instance.str("intro") ?: view.module.intro
            if (html.isNullOrBlank()) {
                EmptyBox("This page has no content yet")
            } else {
                SectionCard { RichText(html) }
            }
        }

        "resource" -> {
            val file = view.body.obj("file")?.toFileRef()
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                instance.str("intro")?.let { SectionCard { RichText(it) } }
                if (file == null) {
                    EmptyBox("No file has been attached yet")
                } else {
                    FileRow(file, onOpenFile)
                }
            }
        }

        "folder" -> {
            val files = view.body.arr("files").toFileRefs()
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                instance.str("intro")?.let { SectionCard { RichText(it) } }
                if (files.isEmpty()) {
                    EmptyBox("This folder is empty")
                } else {
                    files.forEach { FileRow(it, onOpenFile) }
                }
            }
        }

        "url" -> {
            val href = instance.str("externalUrl")
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                instance.str("intro")?.let { SectionCard { RichText(it) } }
                if (href.isNullOrBlank()) {
                    EmptyBox("No link has been set")
                } else {
                    SectionCard {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null)
                            Text(href, style = MaterialTheme.typography.bodyMedium)
                        }
                        Button(
                            onClick = { onOpenUrl(href) },
                            modifier = Modifier.fillMaxWidth(),
                        ) { Text("Open in browser") }
                    }
                }
            }
        }

        "assign" -> AssignBody(view, vm, isLearner, onOpenFile)

        "quiz" -> QuizIntro(view, isLearner, onSitQuiz)

        else -> {
            val html = instance.str("intro") ?: view.module.intro
            if (html.isNullOrBlank()) {
                EmptyBox("Nothing to show here", hint = "Ask your teacher about this activity.")
            } else {
                SectionCard { RichText(html) }
            }
        }
    }
}

/** mod_assign — hand work in. */
@Composable
private fun AssignBody(
    view: ModuleViewEnvelope,
    vm: ModuleViewModel,
    isLearner: Boolean,
    onOpenFile: (String) -> Unit,
) {
    val instance = view.body.instance()
    val submission = view.body.obj("submission")
    var text by remember(submission) { mutableStateOf(submission.str("content").orEmpty()) }

    val types = instance.strings("submissionTypes").ifEmpty { listOf("online_text", "file") }
    val acceptsText = "online_text" in types
    val acceptsFiles = "file" in types
    val attemptsUsed = view.body.int("attemptsUsed") ?: 0
    val maxAttempts = view.body.int("maxAttempts") ?: 1
    val exhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts && submission.str("status") != "draft"
    // The server owns this answer and re-checks it on submit.
    val closed = view.body.bool("canSubmit") == false
    val maySubmit = isLearner && view.capabilities.can(Caps.ASSIGN_SUBMIT) && !closed && !exhausted

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { uris ->
        uris.forEach(vm::attach)
    }

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        (instance.str("intro") ?: view.module.intro)?.let { SectionCard { RichText(it) } }

        SectionCard {
            Text("Your work", style = MaterialTheme.typography.titleSmall)

            if (submission != null) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = PortalColors.success)
                    Text("Handed in", fontWeight = FontWeight.SemiBold)
                    submission.str("status")?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                submission.str("content")?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                submission.arr("files").toFileRefs().forEach { FileRow(it, onOpenFile) }
                submission.str("feedback")?.let { feedback ->
                    Text(
                        "What your teacher said",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    RichText(feedback)
                }
            } else {
                Text(
                    "You have not handed this in yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (maySubmit) {
                if (acceptsText) {
                    OutlinedTextField(
                        value = text,
                        onValueChange = { text = it },
                        label = { Text(if (submission != null) "Change your answer" else "Your answer") },
                        minLines = 4,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                if (acceptsFiles) {
                    OutlinedButton(
                        onClick = { picker.launch("*/*") },
                        enabled = !vm.busy,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Icon(Icons.Outlined.AttachFile, contentDescription = null)
                        Text(if (vm.busy) "  Uploading…" else "  Attach a file or photo")
                    }
                    vm.attachments.forEach { file ->
                        AssistChip(
                            onClick = { vm.removeAttachment(file.id) },
                            label = { Text("${file.filename} ${formatBytes(file.byteSize)} · remove") },
                        )
                    }
                }
                Button(
                    onClick = { vm.handIn(text) },
                    enabled = !vm.busy && (text.isNotBlank() || vm.attachments.isNotEmpty()),
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) {
                    Icon(Icons.AutoMirrored.Outlined.Send, contentDescription = null)
                    Text(if (submission != null) "  Hand in again" else "  Hand in")
                }
                if (maxAttempts > 0) {
                    Text(
                        "Try ${minOf(attemptsUsed + 1, maxAttempts)} of $maxAttempts",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            if (closed) {
                Text(
                    "Hand-in has closed for this work.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            } else if (exhausted) {
                Text(
                    "You have used all $maxAttempts of your tries.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!isLearner) {
                Text(
                    "You are viewing this as a parent.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** mod_quiz — the attempt itself runs in its own screen. */
@Composable
private fun QuizIntro(view: ModuleViewEnvelope, isLearner: Boolean, onSit: () -> Unit) {
    val instance = view.body.instance()
    val attemptsUsed = view.body.int("attemptsUsed") ?: 0
    val maxAttempts = instance.int("maxAttempts") ?: view.body.int("maxAttempts") ?: 0
    val paperId = view.body.str("paperId")
    val exhausted = maxAttempts > 0 && attemptsUsed >= maxAttempts
    val mayAttempt = isLearner && view.capabilities.can(Caps.QUIZ_ATTEMPT) && !exhausted && paperId != null

    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        (instance.str("intro") ?: view.module.intro)?.let { SectionCard { RichText(it) } }
        SectionCard {
            instance.int("timeLimitSeconds")?.let {
                Text("Time: ${it / 60} min", style = MaterialTheme.typography.bodyMedium)
            }
            if (maxAttempts > 0) {
                Text("Tries: $attemptsUsed of $maxAttempts used", style = MaterialTheme.typography.bodyMedium)
            }
            view.module.grade?.let {
                Text("Out of ${it.maxScore.toInt()}", style = MaterialTheme.typography.bodyMedium)
            }
            when {
                mayAttempt -> Button(
                    onClick = onSit,
                    modifier = Modifier.fillMaxWidth().height(50.dp),
                ) { Text(if (attemptsUsed > 0) "Try again" else "Start") }

                exhausted -> Text(
                    "You have used all $maxAttempts of your tries.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                paperId == null -> Text(
                    "This quiz has no questions in it yet.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                else -> Text(
                    "You are viewing this as a parent.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun FileRow(file: FileRef, onOpen: (String) -> Unit) {
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.weight(1f)) {
                Text(file.filename, style = MaterialTheme.typography.bodyMedium)
                val size = formatBytes(file.byteSize)
                if (size.isNotBlank()) {
                    Text(
                        size,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            OutlinedButton(onClick = { onOpen(file.id) }) {
                Icon(Icons.Outlined.Download, contentDescription = null, modifier = Modifier.size(18.dp))
                Text("  Open")
            }
        }
    }
}

/**
 * The mark.
 *
 * The envelope carries a score only once moderation has approved it, so there
 * are three distinct states here and never a bare zero standing in for
 * "waiting".
 */
@Composable
private fun GradeCard(view: ModuleViewEnvelope) {
    when (val grade = view.module.grade.describe()) {
        is GradeDisplay.None -> Unit
        is GradeDisplay.Withheld -> SectionCard {
            Text("YOUR MARK", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("Not released yet", style = MaterialTheme.typography.titleSmall)
            Text(
                "Your teacher is still checking. It will appear here once it is ready.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        is GradeDisplay.Scored -> SectionCard {
            Text("YOUR MARK", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(grade.label, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            grade.percent?.let {
                Text(
                    "${it.toInt()}%",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}
