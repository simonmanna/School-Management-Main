import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from '@/pages/login';
import { SetPasswordPage } from '@/pages/set-password';
import { ForgotPasswordPage } from '@/pages/forgot-password';
import { NoAccessPage } from '@/pages/no-access';
import { RequireAuth, RequireAudience, LandingRedirect } from '@/components/guards';
import { PortalShell } from '@/components/portal-shell';
import { SiteShell, ScrollToTop } from '@/site/site-shell';

/**
 * Routes.
 *
 * Two apps in one deployment, joined at `/login`.
 *
 * `/` and everything under it is the public school website — open to anyone,
 * indexable, and the page a family lands on from a search result. Behind
 * `/login` are the signed-in workspaces, one per audience. They share an origin
 * so that "Sign in" is a router link rather than a jump to a second host, and
 * so a guardian who bookmarked the site does not have to learn a second address
 * to check a fee balance.
 *
 * Every screen behind the login is lazy. The admin app imports all 292 of its
 * pages eagerly into one 6 MB chunk, which is survivable on a school LAN and not
 * survivable for a guardian on mobile data — so the portal splits from the first
 * commit rather than promising to do it later. A parent downloads the parent
 * screens; the teacher marking views are never fetched for them at all. The
 * public pages split the same way: a signed-in parent checking fees never
 * downloads the admissions prose, and a prospective family never downloads the
 * marking workspace.
 */

/* ── Public website ── */
const HomePage = lazy(() => import('@/site/pages/home'));
const AboutPage = lazy(() => import('@/site/pages/about'));
const AcademicsPage = lazy(() => import('@/site/pages/academics'));
const AdmissionsPage = lazy(() => import('@/site/pages/admissions'));
const NewsPage = lazy(() => import('@/site/pages/news'));
const NewsItemPage = lazy(() => import('@/site/pages/news-item'));
const ContactPage = lazy(() => import('@/site/pages/contact'));
const PortalsPage = lazy(() => import('@/site/pages/portals'));
const VerifyPage = lazy(() => import('@/site/pages/verify'));
const UnconfiguredSitePage = lazy(() => import('@/site/pages/unconfigured'));
/** Set once site/content.ts holds the school's real details. */
const SITE_READY = import.meta.env.VITE_SITE_CONTENT_READY === 'true';

/* ── Signed-in workspaces ── */
// Shared by all three audiences: the school's message history for whoever is
// signed in. The subject is the token, not the route.
const PortalNotices = lazy(() => import('@/routes/shared/notices'));

const ParentHome = lazy(() => import('@/routes/parent/home'));
const ParentFees = lazy(() => import('@/routes/parent/fees'));
const ParentAttendance = lazy(() => import('@/routes/parent/attendance'));
const ParentResults = lazy(() => import('@/routes/parent/results'));
const ParentGoingHome = lazy(() => import('@/routes/parent/going-home'));

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
    <>
      <ScrollToTop />
      <Routes>
        {/* ── The public website. No auth, no portal context fetch. ── */}
        <Route element={<SiteShell />}>
          {/* The marketing pages carry sample content (site/content.ts) until the
              school fills it in; publishing it under a real school's name would
              invent its statistics, dates and phone numbers. */}
          <Route index element={SITE_READY ? <HomePage /> : <UnconfiguredSitePage />} />
          <Route path="/about" element={SITE_READY ? <AboutPage /> : <UnconfiguredSitePage />} />
          <Route path="/academics" element={SITE_READY ? <AcademicsPage /> : <UnconfiguredSitePage />} />
          <Route path="/admissions" element={SITE_READY ? <AdmissionsPage /> : <UnconfiguredSitePage />} />
          <Route path="/news" element={SITE_READY ? <NewsPage /> : <UnconfiguredSitePage />} />
          <Route path="/news/:slug" element={SITE_READY ? <NewsItemPage /> : <UnconfiguredSitePage />} />
          <Route path="/contact" element={SITE_READY ? <ContactPage /> : <UnconfiguredSitePage />} />
          <Route path="/portals" element={<PortalsPage />} />
          <Route path="/verify" element={<VerifyPage />} />
        </Route>

        {/* Signed-out account screens. `accept-invite` and `reset-password` are
            reached from an email link carrying a one-time token, so they must
            render signed out. They keep their own bare layout: a one-time link
            is not a place to offer someone the news page. */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<SetPasswordPage mode="invite" />} />
        <Route path="/reset-password" element={<SetPasswordPage mode="reset" />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/no-access" element={<NoAccessPage />} />

          {/* The server decides which workspace this account belongs in. `/`
              belongs to the website now, so the landing redirect has its own
              path — it is also where the header's "My portal" button points. */}
          <Route path="/home" element={<LandingRedirect />} />

          <Route element={<RequireAudience audience="parent" />}>
            <Route path="/parent" element={<PortalShell audience="parent" />}>
              <Route index element={<ParentHome />} />
              <Route path="fees" element={<ParentFees />} />
              <Route path="attendance" element={<ParentAttendance />} />
              <Route path="results" element={<ParentResults />} />
              <Route path="going-home" element={<ParentGoingHome />} />
              <Route path="notices" element={<PortalNotices />} />
            </Route>
          </Route>

          <Route element={<RequireAudience audience="student" />}>
            <Route path="/student" element={<PortalShell audience="student" />}>
              <Route index element={<StudentHome />} />
              <Route path="courses" element={<StudentCourses />} />
              <Route path="results" element={<StudentResults />} />
              <Route path="attendance" element={<StudentAttendance />} />
              <Route path="notices" element={<PortalNotices />} />
            </Route>
          </Route>

          <Route element={<RequireAudience audience="teacher" />}>
            <Route path="/teacher" element={<PortalShell audience="teacher" />}>
              <Route index element={<TeacherHome />} />
              <Route path="classes" element={<TeacherClasses />} />
              <Route path="register" element={<TeacherRegister />} />
              <Route path="marking" element={<TeacherMarking />} />
              <Route path="me" element={<TeacherMe />} />
              <Route path="notices" element={<PortalNotices />} />
            </Route>
          </Route>
        </Route>

        {/* A mistyped path lands on the public home page. It used to send a
            signed-in user to their own landing, which is now a click away in the
            header — and an unknown URL is far more likely to be a stale link
            from outside than a signed-in user fat-fingering a route. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
