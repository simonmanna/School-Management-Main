package com.school.portal.ui.screens.student

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavHostController
import com.school.portal.AppContainer
import com.school.portal.data.model.Attempt
import com.school.portal.data.model.AttemptQuestion
import com.school.portal.data.model.str
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingBox
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.RichText
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.formatClock
import com.school.portal.ui.common.portalViewModel
import com.school.portal.ui.theme.PortalColors
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.Instant

/**
 * Sitting a quiz.
 *
 * Thin on purpose. The CBT engine realises the questions, persists each
 * response, marks the objective ones, counts attempts and decides when time is
 * up — and it refuses a save that arrives after expiry. This screen moves
 * between questions, autosaves, and submits. It never scores anything, and the
 * countdown it draws is a courtesy rather than the rule.
 */
class QuizViewModel(
    private val repo: PortalRepository,
    private val moduleId: String,
    private val studentProfileId: String?,
    private val guardian: Boolean,
) : ViewModel() {

    private val _attempt = MutableStateFlow<Attempt?>(null)
    val attempt: StateFlow<Attempt?> = _attempt.asStateFlow()

    private val _failure = MutableStateFlow<String?>(null)
    val failure: StateFlow<String?> = _failure.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _submitting = MutableStateFlow(false)
    val submitting: StateFlow<Boolean> = _submitting.asStateFlow()

    /** Answers held locally so a jump back to a question shows what was chosen. */
    var answers by mutableStateOf<Map<String, JsonObject>>(emptyMap())
        private set

    private var sequence = 0
    private var opened = false

    init {
        open()
    }

    /**
     * Open the attempt once, and only for the pupil themselves.
     *
     * The guard matters: a second call burns another attempt out of the
     * learner's allowance, which the web portal had to fix with a ref for
     * exactly the same reason.
     */
    private fun open() {
        if (opened || guardian) return
        opened = true
        viewModelScope.launch {
            val view = repo.moduleView(moduleId)
            if (view is ApiResult.Failed) {
                _failure.value = view.error.message
                return@launch
            }
            val envelope = (view as ApiResult.Ok).value
            val paperId = envelope.body.str("paperId")
            if (paperId == null) {
                _failure.value = "This quiz has no questions in it yet."
                return@launch
            }
            val sitter = studentProfileId
            if (sitter == null) {
                _failure.value = "This session is not linked to a pupil."
                return@launch
            }
            when (val started = repo.startAttempt(paperId, sitter)) {
                is ApiResult.Ok -> _attempt.value = started.value
                is ApiResult.Failed -> _failure.value = started.error.message
            }
        }
    }

    /**
     * Record one answer and send it.
     *
     * Losing an answer quietly is worse than a visible warning: the learner can
     * tap it again while the attempt is still open, so a failed save says so.
     */
    fun answer(questionId: String, response: JsonObject) {
        answers = answers + (questionId to response)
        val attemptId = _attempt.value?.id ?: return
        sequence += 1
        val n = sequence
        viewModelScope.launch {
            val result = repo.saveResponse(attemptId, questionId, response, n)
            if (result is ApiResult.Failed) {
                _message.value = "That answer did not save — tap it again"
            }
        }
    }

    fun handIn() {
        val attemptId = _attempt.value?.id ?: return
        viewModelScope.launch {
            _submitting.value = true
            when (val result = repo.submitAttempt(attemptId)) {
                is ApiResult.Ok -> when (val fresh = repo.attempt(attemptId)) {
                    is ApiResult.Ok -> _attempt.value = fresh.value
                    is ApiResult.Failed -> _message.value = fresh.error.message
                }
                is ApiResult.Failed -> _message.value = result.error.message
            }
            _submitting.value = false
        }
    }

    fun messageShown() {
        _message.value = null
    }
}

@Composable
fun QuizScreen(
    container: AppContainer,
    navController: NavHostController,
    moduleId: String,
) {
    val portal by container.session.portal.collectAsStateWithLifecycle()
    val activeStudent by container.session.activeStudentId.collectAsStateWithLifecycle()
    val guardian = portal?.isGuardian == true

    val vm = portalViewModel(container, key = "quiz-$moduleId") { repo ->
        QuizViewModel(repo, moduleId, activeStudent ?: portal?.students?.firstOrNull()?.studentProfileId, guardian)
    }
    val attempt by vm.attempt.collectAsStateWithLifecycle()
    val failure by vm.failure.collectAsStateWithLifecycle()
    val message by vm.message.collectAsStateWithLifecycle()
    val submitting by vm.submitting.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.messageShown()
        }
    }

    var index by remember { mutableIntStateOf(0) }

    Scaffold(snackbarHost = { SnackbarHost(snackbar) }) { padding ->
        Column(Modifier.padding(padding).fillMaxWidth()) {
            PortalTopBar(
                container = container,
                title = "Quiz",
                onBack = { navController.popBackStack() },
            )
            when {
                guardian -> EmptyBox(
                    title = "Only your child can sit this quiz",
                    hint = "You can see the mark once it is released.",
                )

                failure != null -> EmptyBox("This quiz could not be started", hint = failure)

                attempt == null -> LoadingBox()

                attempt!!.handedIn -> HandedIn { navController.popBackStack() }

                attempt!!.questions.isEmpty() -> EmptyBox("There are no questions in this quiz")

                else -> {
                    val questions = attempt!!.questions
                    val current = questions[index.coerceIn(0, questions.lastIndex)]
                    QuizBody(
                        attempt = attempt!!,
                        questions = questions,
                        current = current,
                        index = index,
                        answers = vm.answers,
                        submitting = submitting,
                        onAnswer = vm::answer,
                        onGo = { index = it },
                        onHandIn = vm::handIn,
                    )
                }
            }
        }
    }
}

@Composable
private fun HandedIn(onBack: () -> Unit) {
    Column(
        Modifier.fillMaxWidth().padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.CheckCircle,
            contentDescription = null,
            tint = PortalColors.success,
            modifier = Modifier.size(44.dp),
        )
        Text("Handed in", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Text(
            "Your answers are saved. Your teacher will release your mark once anything that needs " +
                "marking by hand has been checked.",
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
            Text("Back to the activity")
        }
    }
}

@Composable
private fun QuizBody(
    attempt: Attempt,
    questions: List<AttemptQuestion>,
    current: AttemptQuestion,
    index: Int,
    answers: Map<String, JsonObject>,
    submitting: Boolean,
    onAnswer: (String, JsonObject) -> Unit,
    onGo: (Int) -> Unit,
    onHandIn: () -> Unit,
) {
    // The server's deadline is what counts; this only draws it.
    var remaining by remember(attempt.expiresAt) { mutableStateOf<Long?>(null) }
    LaunchedEffect(attempt.expiresAt) {
        val expiry = attempt.expiresAt?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: return@LaunchedEffect
        while (true) {
            remaining = (expiry.toEpochMilli() - System.currentTimeMillis()).coerceAtLeast(0)
            delay(1000)
        }
    }

    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        "Question ${index + 1} of ${questions.size}",
                        style = MaterialTheme.typography.titleSmall,
                    )
                    Text(
                        "${answers.size} answered",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                remaining?.let { left ->
                    AssistChip(
                        onClick = {},
                        label = { Text(formatClock(left)) },
                        leadingIcon = {
                            Icon(Icons.Outlined.Schedule, contentDescription = null, modifier = Modifier.size(16.dp))
                        },
                        colors = if (left < 60_000) {
                            AssistChipDefaults.assistChipColors(labelColor = MaterialTheme.colorScheme.error)
                        } else {
                            AssistChipDefaults.assistChipColors()
                        },
                    )
                }
            }
            if (remaining == 0L) {
                Text(
                    "Time is up. The school's system will hand this in for you.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            LinearProgressIndicator(
                progress = { (index + 1).toFloat() / questions.size },
                modifier = Modifier.fillMaxWidth().height(6.dp).padding(top = 8.dp),
            )
        }

        item {
            SectionCard {
                current.marks?.let {
                    Text(
                        "${it.toInt()} mark${if (it.toInt() == 1) "" else "s"}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                RichText(current.prompt)
                AnswerInput(
                    question = current,
                    value = answers[current.questionId],
                    onChange = { onAnswer(current.questionId, it) },
                )
            }
        }

        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                OutlinedButton(
                    onClick = { onGo(index - 1) },
                    enabled = index > 0,
                    modifier = Modifier.height(50.dp),
                ) { Text("Back") }
                if (index == questions.lastIndex) {
                    Button(
                        onClick = onHandIn,
                        enabled = !submitting,
                        modifier = Modifier.weight(1f).height(50.dp),
                    ) { Text(if (submitting) "Handing in…" else "Hand in") }
                } else {
                    Button(
                        onClick = { onGo(index + 1) },
                        modifier = Modifier.weight(1f).height(50.dp),
                    ) { Text("Next") }
                }
            }
        }

        if (questions.size > 1) {
            item {
                LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    itemsIndexed(questions) { i, question ->
                        val answered = answers.containsKey(question.questionId)
                        AssistChip(
                            onClick = { onGo(i) },
                            label = { Text("${i + 1}") },
                            colors = when {
                                i == index -> AssistChipDefaults.assistChipColors(
                                    containerColor = MaterialTheme.colorScheme.primary,
                                    labelColor = MaterialTheme.colorScheme.onPrimary,
                                )
                                answered -> AssistChipDefaults.assistChipColors(
                                    containerColor = PortalColors.successContainer,
                                )
                                else -> AssistChipDefaults.assistChipColors()
                            },
                        )
                    }
                }
            }
        }

        item {
            Text(
                "Your answers save as you go.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/**
 * The control for one question, by type.
 *
 * `matching` has no learner-side widget: the engine strips the pairs a matcher
 * would need, so it falls through to a written answer that a teacher marks by
 * hand — the same as the staff app does.
 */
@Composable
private fun AnswerInput(
    question: AttemptQuestion,
    value: JsonObject?,
    onChange: (JsonObject) -> Unit,
) {
    val options = question.options

    if (question.type == "mcq_multi") {
        val chosen = (value?.get("optionIds") as? JsonArray)
            ?.mapNotNull { (it as? JsonPrimitive)?.content }
            .orEmpty()
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                "Choose all the right answers.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            options.forEach { option ->
                val picked = option.id in chosen
                Row(
                    Modifier
                        .fillMaxWidth()
                        .selectable(selected = picked, onClick = {
                            val next = if (picked) chosen - option.id else chosen + option.id
                            onChange(
                                JsonObject(mapOf("optionIds" to JsonArray(next.map { JsonPrimitive(it) }))),
                            )
                        })
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = picked, onCheckedChange = null)
                    Box(Modifier.padding(start = 8.dp)) { RichText(option.label) }
                }
            }
        }
        return
    }

    if (options.isNotEmpty()) {
        // mcq_single and true_false both answer with one optionId.
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            options.forEach { option ->
                val picked = (value?.get("optionId") as? JsonPrimitive)?.content == option.id
                Row(
                    Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = picked,
                            onClick = { onChange(JsonObject(mapOf("optionId" to JsonPrimitive(option.id)))) },
                        )
                        .padding(vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(selected = picked, onClick = null)
                    Box(Modifier.padding(start = 8.dp)) { RichText(option.label) }
                }
            }
        }
        return
    }

    // A typed answer is debounced before it is sent. Saving on every keystroke
    // would put one request per character on a phone tether, and the engine
    // keeps only the latest response for a question anyway.
    val key = if (question.type == "numeric") "value" else "text"
    var typed by remember(question.questionId) {
        mutableStateOf((value?.get(key) as? JsonPrimitive)?.content.orEmpty())
    }
    var dirty by remember(question.questionId) { mutableStateOf(false) }
    LaunchedEffect(typed, dirty) {
        if (!dirty) return@LaunchedEffect
        delay(700)
        onChange(JsonObject(mapOf(key to JsonPrimitive(typed))))
    }
    OutlinedTextField(
        value = typed,
        onValueChange = {
            typed = it
            dirty = true
        },
        label = { Text("Your answer") },
        singleLine = question.type == "numeric",
        minLines = if (question.type == "numeric") 1 else if (question.type == "essay") 8 else 3,
        keyboardOptions = if (question.type == "numeric") {
            KeyboardOptions(keyboardType = KeyboardType.Decimal)
        } else {
            KeyboardOptions.Default
        },
        modifier = Modifier.fillMaxWidth(),
    )
}
