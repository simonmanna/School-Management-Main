import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/login';
import { SetPasswordPage } from '@/pages/set-password';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { NoAccessPage } from '@/pages/no-access';
import { RequireAuth, RequireAudience, LandingRedirect } from '@/components/guards';
import { PortalShell } from '@/components/portal-shell';

/**
 * Routes.
 *
 * Every screen behind the login is lazy. The admin app imports all 292 of its
 * pages eagerly into one 6 MB chunk, which is survivable on a school LAN and not
 * survivable for a guardian on mobile data — so the portal splits from the first
 * commit rather than promising to do it later. A parent downloads the parent
 * screens; the teacher marking views are never fetched for them at all.
 */

const ParentHome = lazy(() => import('@/routes/parent/home'));
const ParentFees = lazy(() => import('@/routes/parent/fees'));
const ParentAttendance = lazy(() => import('@/routes/parent/attendance'));
const ParentResults = lazy(() => import('@/routes/parent/results'));

const StudentHome = lazy(() => import('@/routes/student/home'));
const StudentCourses = lazy(() => import('@/routes/student/courses'));
const StudentResults = lazy(() => import('@/routes/student/results'));
const StudentAttendance = lazy(() => import('@/routes/student/attendance'));

const TeacherHome = lazy(() => import('@/routes/teacher/home'));
const TeacherClasses = lazy(() => import('@/routes/teacher/classes'));
const TeacherMarking = lazy(() => import('@/routes/teacher/marking'));
const TeacherRegister = lazy(() => import('@/routes/teacher/register'));
const TeacherMe = lazy(() => import('@/routes/teacher/me'));

export default function App() {
  return (
    <Routes>
      {/* Public. `accept-invite` and `reset-password` are reached from an email
          link carrying a one-time token, so they must render signed out. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept-invite" element={<SetPasswordPage mode="invite" />} />
      <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/no-access" element={<NoAccessPage />} />

        {/* The server decides which workspace this account belongs in. */}
        <Route index element={<LandingRedirect />} />

        <Route element={<RequireAudience audience="parent" />}>
          <Route path="/parent" element={<PortalShell audience="parent" />}>
            <Route index element={<ParentHome />} />
            <Route path="fees" element={<ParentFees />} />
            <Route path="attendance" element={<ParentAttendance />} />
            <Route path="results" element={<ParentResults />} />
          </Route>
        </Route>

        <Route element={<RequireAudience audience="student" />}>
          <Route path="/student" element={<PortalShell audience="student" />}>
            <Route index element={<StudentHome />} />
            <Route path="courses" element={<StudentCourses />} />
            <Route path="results" element={<StudentResults />} />
            <Route path="attendance" element={<StudentAttendance />} />
          </Route>
        </Route>

        <Route element={<RequireAudience audience="teacher" />}>
          <Route path="/teacher" element={<PortalShell audience="teacher" />}>
            <Route index element={<TeacherHome />} />
            <Route path="classes" element={<TeacherClasses />} />
            <Route path="register" element={<TeacherRegister />} />
            <Route path="marking" element={<TeacherMarking />} />
            <Route path="me" element={<TeacherMe />} />
          </Route>
        </Route>
      </Route>

      {/* A mistyped path sends a signed-in user to their own landing rather than
          to a shared home screen that may not be theirs. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
