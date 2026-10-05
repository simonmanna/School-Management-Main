package com.school.portal.ui.common

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.SwitchAccount
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.school.portal.AppContainer

/**
 * The bar at the top of every screen.
 *
 * It carries the two things that belong to the session rather than to any one
 * screen: which child a guardian is looking at, and the way out. The child
 * picker only appears when the server actually gave this session more than one
 * pupil — a single-child parent should never be asked to choose.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PortalTopBar(
    container: AppContainer,
    title: String,
    subtitle: String? = null,
    onBack: (() -> Unit)? = null,
) {
    val portal by container.session.portal.collectAsStateWithLifecycle()
    val activeId by container.session.activeStudentId.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }
    var childrenOpen by remember { mutableStateOf(false) }

    val students = portal?.students ?: emptyList()
    val activeName = students.firstOrNull { it.studentProfileId == activeId }?.name

    TopAppBar(
        title = {
            Text(
                text = title,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = MaterialTheme.typography.titleMedium,
            )
            if (subtitle != null || (students.size > 1 && activeName != null)) {
                Text(
                    text = subtitle ?: activeName.orEmpty(),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        navigationIcon = {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back")
                }
            }
        },
        actions = {
            if (students.size > 1) {
                IconButton(onClick = { childrenOpen = true }) {
                    Icon(Icons.Outlined.SwitchAccount, contentDescription = "Switch child")
                }
                DropdownMenu(expanded = childrenOpen, onDismissRequest = { childrenOpen = false }) {
                    students.forEach { student ->
                        DropdownMenuItem(
                            text = {
                                Text(
                                    student.name + (student.className?.let { " · $it" } ?: ""),
                                    fontWeight = if (student.studentProfileId == activeId) {
                                        androidx.compose.ui.text.font.FontWeight.Bold
                                    } else {
                                        androidx.compose.ui.text.font.FontWeight.Normal
                                    },
                                )
                            },
                            onClick = {
                                container.session.setActiveStudent(student.studentProfileId)
                                childrenOpen = false
                            },
                        )
                    }
                }
            }
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.AutoMirrored.Outlined.Logout, contentDescription = "Account")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Sign out") },
                    onClick = {
                        menuOpen = false
                        container.repository.signOut()
                    },
                )
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surface,
        ),
    )
}
