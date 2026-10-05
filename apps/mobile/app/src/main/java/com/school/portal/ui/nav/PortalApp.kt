package com.school.portal.ui.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Checklist
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Workspaces
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.school.portal.AppContainer
import com.school.portal.ui.screens.NoticesScreen
import com.school.portal.ui.screens.auth.LoginScreen
import com.school.portal.ui.screens.student.CourseScreen
import com.school.portal.ui.screens.student.CoursesScreen
import com.school.portal.ui.screens.student.MarksScreen
import com.school.portal.ui.screens.student.ModuleScreen
import com.school.portal.ui.screens.student.QuizScreen
import com.school.portal.ui.screens.student.StudentHomeScreen
import com.school.portal.ui.screens.teacher.MarkSheetScreen
import com.school.portal.ui.screens.teacher.MarkingScreen
import com.school.portal.ui.screens.teacher.RegisterScreen
import com.school.portal.ui.screens.teacher.TeacherClassesScreen
import com.school.portal.ui.screens.teacher.TeacherHomeScreen

/** Every destination, as one list rather than strings spread over the screens. */
object Routes {
    const val LOGIN = "login"

    const val STUDENT_HOME = "student/home"
    const val STUDENT_COURSES = "student/courses"
    const val STUDENT_MARKS = "student/marks"
    const val COURSE = "student/courses/{courseId}"
    const val MODULE = "student/courses/{courseId}/modules/{moduleId}"
    const val QUIZ = "student/quiz/{moduleId}"

    const val TEACHER_HOME = "teacher/home"
    const val TEACHER_CLASSES = "teacher/classes"
    const val TEACHER_MARKING = "teacher/marking"
    const val REGISTER = "teacher/register/{classId}?name={name}"
    const val MARK_SHEET = "teacher/marking/{assessmentId}?title={title}"

    const val NOTICES = "notices"

    fun course(courseId: String) = "student/courses/$courseId"
    fun module(courseId: String, moduleId: String) = "student/courses/$courseId/modules/$moduleId"
    fun quiz(moduleId: String) = "student/quiz/$moduleId"
    fun register(classId: String, name: String) =
        "teacher/register/$classId?name=${java.net.URLEncoder.encode(name, "UTF-8")}"
    fun markSheet(assessmentId: String, title: String) =
        "teacher/marking/$assessmentId?title=${java.net.URLEncoder.encode(title, "UTF-8")}"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector)

/**
 * The app.
 *
 * Which tabs exist is decided by what the SERVER said this session is
 * (`school/portals/me`), not by anything the device chose: a teacher who is also
 * a parent gets the teacher shell because that is the landing the server names,
 * and a pupil never sees a register tab because the routes behind it would 403.
 */
@Composable
fun PortalApp(container: AppContainer) {
    val signedIn by container.session.signedIn.collectAsStateWithLifecycle()
    val portal by container.session.portal.collectAsStateWithLifecycle()

    if (!signedIn) {
        LoginScreen(container)
        return
    }

    val staff = portal?.isStaff == true || portal?.defaultLanding == "teacher"
    val navController = rememberNavController()

    val tabs = if (staff) {
        listOf(
            Tab(Routes.TEACHER_HOME, "Today", Icons.Outlined.Home),
            Tab(Routes.TEACHER_CLASSES, "Classes", Icons.Outlined.Groups),
            Tab(Routes.TEACHER_MARKING, "Marking", Icons.Outlined.Checklist),
            Tab(Routes.NOTICES, "Notices", Icons.Outlined.Campaign),
        )
    } else {
        listOf(
            Tab(Routes.STUDENT_HOME, "Home", Icons.Outlined.Home),
            Tab(Routes.STUDENT_COURSES, "Courses", Icons.AutoMirrored.Outlined.MenuBook),
            Tab(Routes.STUDENT_MARKS, "Marks", Icons.Outlined.Workspaces),
            Tab(Routes.NOTICES, "Notices", Icons.Outlined.Campaign),
        )
    }

    Scaffold(
        bottomBar = { PortalBottomBar(navController, tabs) },
    ) { padding ->
        Surface(
            modifier = Modifier.fillMaxSize().padding(padding),
            color = MaterialTheme.colorScheme.background,
        ) {
            NavHost(
                navController = navController,
                startDestination = if (staff) Routes.TEACHER_HOME else Routes.STUDENT_HOME,
            ) {
                composable(Routes.STUDENT_HOME) { StudentHomeScreen(container, navController) }
                composable(Routes.STUDENT_COURSES) { CoursesScreen(container, navController) }
                composable(Routes.STUDENT_MARKS) { MarksScreen(container) }
                composable(Routes.COURSE) { entry ->
                    CourseScreen(
                        container = container,
                        navController = navController,
                        courseId = entry.arguments?.getString("courseId").orEmpty(),
                    )
                }
                composable(Routes.MODULE) { entry ->
                    ModuleScreen(
                        container = container,
                        navController = navController,
                        courseId = entry.arguments?.getString("courseId").orEmpty(),
                        moduleId = entry.arguments?.getString("moduleId").orEmpty(),
                    )
                }
                composable(Routes.QUIZ) { entry ->
                    QuizScreen(
                        container = container,
                        navController = navController,
                        moduleId = entry.arguments?.getString("moduleId").orEmpty(),
                    )
                }

                composable(Routes.TEACHER_HOME) { TeacherHomeScreen(container, navController) }
                composable(Routes.TEACHER_CLASSES) { TeacherClassesScreen(container, navController) }
                composable(Routes.TEACHER_MARKING) { MarkingScreen(container, navController) }
                composable(Routes.REGISTER) { entry ->
                    RegisterScreen(
                        container = container,
                        navController = navController,
                        classId = entry.arguments?.getString("classId").orEmpty(),
                        className = entry.arguments?.getString("name").orEmpty(),
                    )
                }
                composable(Routes.MARK_SHEET) { entry ->
                    MarkSheetScreen(
                        container = container,
                        navController = navController,
                        assessmentId = entry.arguments?.getString("assessmentId").orEmpty(),
                        title = entry.arguments?.getString("title").orEmpty(),
                    )
                }

                composable(Routes.NOTICES) { NoticesScreen(container) }
            }
        }
    }
}

@Composable
private fun PortalBottomBar(navController: NavHostController, tabs: List<Tab>) {
    val entry by navController.currentBackStackEntryAsState()
    val current = entry?.destination
    NavigationBar {
        tabs.forEach { tab ->
            val selected = current?.hierarchy?.any { it.route == tab.route } == true
            NavigationBarItem(
                selected = selected,
                onClick = {
                    navController.navigate(tab.route) {
                        // One entry per tab, and tapping the current tab returns
                        // to its root instead of stacking another copy.
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { Icon(tab.icon, contentDescription = null) },
                label = { Text(tab.label) },
            )
        }
    }
}

/** Keeps the signed-out branch from drawing a stray bottom bar behind the form. */
@Composable
fun Blank() {
    Box(Modifier.fillMaxSize())
}
