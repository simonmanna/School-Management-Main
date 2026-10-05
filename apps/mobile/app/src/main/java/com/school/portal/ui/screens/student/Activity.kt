package com.school.portal.ui.screens.student

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Assignment
import androidx.compose.material.icons.automirrored.outlined.InsertDriveFile
import androidx.compose.material.icons.automirrored.outlined.Label
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Quiz
import androidx.compose.material.icons.outlined.Slideshow
import androidx.compose.material.icons.outlined.Task
import androidx.compose.ui.graphics.vector.ImageVector

/**
 * How an activity type reads to a pupil.
 *
 * The server sends an icon name per activity, but it names Moodle's icon set,
 * which does not exist on Android. Mapping the activity TYPE instead keeps the
 * two independent: a new plugin gets a sensible default here rather than a
 * missing-asset box.
 */
fun activityLabel(activityType: String): String = when (activityType) {
    "assign" -> "Homework"
    "quiz" -> "Quiz"
    "page" -> "Page"
    "resource" -> "File"
    "folder" -> "Folder"
    "url" -> "Link"
    "forum" -> "Discussion"
    "lesson" -> "Lesson"
    "label" -> "Note"
    "scorm" -> "Learning package"
    "choice" -> "Poll"
    "feedback" -> "Feedback"
    "workshop" -> "Peer review"
    "glossary" -> "Glossary"
    "book" -> "Book"
    else -> activityType.replaceFirstChar { it.uppercase() }
}

fun activityIcon(activityType: String): ImageVector = when (activityType) {
    "assign" -> Icons.AutoMirrored.Outlined.Assignment
    "quiz" -> Icons.Outlined.Quiz
    "page", "book", "lesson" -> Icons.AutoMirrored.Outlined.MenuBook
    "resource" -> Icons.AutoMirrored.Outlined.InsertDriveFile
    "folder" -> Icons.Outlined.Folder
    "url" -> Icons.Outlined.Link
    "forum" -> Icons.Outlined.Forum
    "label" -> Icons.AutoMirrored.Outlined.Label
    "scorm" -> Icons.Outlined.Slideshow
    else -> Icons.Outlined.Task
}
