package com.school.portal.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.school.portal.AppContainer
import com.school.portal.data.net.ApiError
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** Loading, loaded, or failed — the only three things a screen has to draw. */
sealed interface ScreenState<out T> {
    data object Loading : ScreenState<Nothing>
    data class Ready<T>(val value: T) : ScreenState<T>
    data class Failed(val error: ApiError) : ScreenState<Nothing>
}

val <T> ScreenState<T>.valueOrNull: T? get() = (this as? ScreenState.Ready)?.value

/**
 * A screen that loads one thing and can reload it.
 *
 * Pull-to-refresh is separated from the first load on purpose: a refresh keeps
 * the old content on screen while it runs, where a reload that drops back to a
 * spinner would make a teacher lose their place in a mark sheet.
 */
abstract class LoadingViewModel<T>(protected val repo: PortalRepository) : ViewModel() {

    private val _state = MutableStateFlow<ScreenState<T>>(ScreenState.Loading)
    val state: StateFlow<ScreenState<T>> = _state.asStateFlow()

    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)

    /** A one-off line for the snackbar: a failed write, a confirmed hand-in. */
    val message: StateFlow<String?> = _message.asStateFlow()

    protected abstract suspend fun load(): ApiResult<T>

    init {
        reload()
    }

    fun reload() {
        viewModelScope.launch {
            when (val result = load()) {
                is ApiResult.Ok -> _state.value = ScreenState.Ready(result.value)
                is ApiResult.Failed -> _state.value = ScreenState.Failed(result.error)
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _refreshing.value = true
            when (val result = load()) {
                is ApiResult.Ok -> _state.value = ScreenState.Ready(result.value)
                // A refresh that fails leaves what is already on screen alone and
                // says so, rather than replacing a readable page with an error.
                is ApiResult.Failed -> if (_state.value is ScreenState.Loading) {
                    _state.value = ScreenState.Failed(result.error)
                } else {
                    say(result.error.message)
                }
            }
            _refreshing.value = false
        }
    }

    protected fun setValue(value: T) {
        _state.value = ScreenState.Ready(value)
    }

    fun say(text: String?) {
        _message.value = text
    }

    fun messageShown() {
        _message.value = null
    }
}

/** Draws the right thing for [state], and the content once there is something to draw. */
@Composable
fun <T> StateBox(
    state: ScreenState<T>,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable (T) -> Unit,
) {
    when (state) {
        is ScreenState.Loading -> LoadingBox(modifier)
        is ScreenState.Failed -> ErrorBox(state.error, modifier, onRetry)
        is ScreenState.Ready -> content(state.value)
    }
}

/**
 * Builds a ViewModel with the app's repository, without a DI framework.
 *
 * Keyed so that two instances of the same screen (two courses on the back
 * stack) do not share one ViewModel.
 */
@Composable
inline fun <reified VM : ViewModel> portalViewModel(
    container: AppContainer,
    key: String? = null,
    crossinline create: (PortalRepository) -> VM,
): VM = viewModel(
    key = key,
    factory = object : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <X : ViewModel> create(modelClass: Class<X>): X =
            create(container.repository) as X
    },
)
