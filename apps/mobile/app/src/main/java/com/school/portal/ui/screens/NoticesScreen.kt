package com.school.portal.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Circle
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
import androidx.lifecycle.viewModelScope
import com.school.portal.AppContainer
import com.school.portal.data.model.PortalNotice
import com.school.portal.data.net.ApiResult
import com.school.portal.data.repo.PortalRepository
import com.school.portal.ui.common.EmptyBox
import com.school.portal.ui.common.LoadingViewModel
import com.school.portal.ui.common.PortalTopBar
import com.school.portal.ui.common.SectionCard
import com.school.portal.ui.common.StateBox
import com.school.portal.ui.common.formatRelative
import com.school.portal.ui.common.plainText
import com.school.portal.ui.common.portalViewModel
import kotlinx.coroutines.launch

class NoticesViewModel(repo: PortalRepository) : LoadingViewModel<List<PortalNotice>>(repo) {
    override suspend fun load(): ApiResult<List<PortalNotice>> = repo.notices()

    fun markRead(notice: PortalNotice) {
        if (notice.readAt != null) return
        viewModelScope.launch {
            when (val result = repo.markNoticeRead(notice.id)) {
                is ApiResult.Ok -> reload()
                is ApiResult.Failed -> say(result.error.message)
            }
        }
    }
}

/**
 * The school's own notice history.
 *
 * A parent told by SMS that fees are due, or that results are out, has no copy
 * once the phone deletes it — the school's record is the only durable one, so
 * the portal shows it. The subject is the token, never a parameter: there is
 * nothing here for a caller to edit.
 */
@Composable
fun NoticesScreen(container: AppContainer) {
    val vm = portalViewModel(container) { NoticesViewModel(it) }
    val state by vm.state.collectAsStateWithLifecycle()

    Column(Modifier.fillMaxWidth()) {
        PortalTopBar(container, title = "Notices")
        StateBox(state, onRetry = vm::reload) { notices ->
            if (notices.isEmpty()) {
                EmptyBox("No notices yet", hint = "Messages the school sends you will appear here.")
            } else {
                LazyColumn(
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(notices, key = { it.id }) { notice ->
                        val unread = notice.readAt == null
                        SectionCard(Modifier.clickable { vm.markRead(notice) }) {
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.Top,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                if (unread) {
                                    Icon(
                                        Icons.Outlined.Circle,
                                        contentDescription = "Unread",
                                        tint = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.size(10.dp),
                                    )
                                }
                                Column(Modifier.weight(1f)) {
                                    Text(
                                        notice.title.ifBlank { notice.category },
                                        style = MaterialTheme.typography.titleSmall,
                                        fontWeight = if (unread) FontWeight.Bold else FontWeight.Normal,
                                    )
                                    Text(
                                        notice.body.plainText(),
                                        style = MaterialTheme.typography.bodyMedium,
                                    )
                                    Text(
                                        listOfNotNull(
                                            notice.channel.takeIf { it.isNotBlank() },
                                            formatRelative(notice.sentAt ?: notice.createdAt),
                                        ).joinToString(" · "),
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
