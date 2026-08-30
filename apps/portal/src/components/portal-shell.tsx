import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Suspense } from 'react';
import {
  Home, Wallet, CalendarCheck, GraduationCap, BookOpen, ClipboardList,
  LogOut, ChevronDown, School,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

const SCHOOL_NAME = import.meta.env.VITE_SCHOOL_NAME ?? 'School Portal';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

const NAV: Record<'parent' | 'student' | 'teacher', NavItem[]> = {
  parent: [
    { to: '/parent', label: 'Home', icon: Home },
    { to: '/parent/fees', label: 'Fees', icon: Wallet },
    { to: '/parent/attendance', label: 'Attendance', icon: CalendarCheck },
    { to: '/parent/results', label: 'Results', icon: GraduationCap },
  ],
  student: [
    { to: '/student', label: 'Today', icon: Home },
    { to: '/student/courses', label: 'Courses', icon: BookOpen },
    { to: '/student/results', label: 'Results', icon: GraduationCap },
    { to: '/student/attendance', label: 'Attendance', icon: CalendarCheck },
  ],
  teacher: [
    { to: '/teacher', label: 'Today', icon: Home },
    { to: '/teacher/register', label: 'Register', icon: ClipboardList },
    { to: '/teacher/marking', label: 'Marking', icon: GraduationCap },
    { to: '/teacher/me', label: 'Me', icon: School },
  ],
};

/**
 * The portal's chrome.
 *
 * Bottom navigation, not a sidebar. The admin app's 24-section rail is right for
 * a person who lives in the software; this is for someone holding a phone in one
 * hand who wants one number and then wants to leave.
 */
export function PortalShell({ audience }: { audience: 'parent' | 'student' | 'teacher' }) {
  const items = NAV[audience];

  return (
    <div className="min-h-dvh bg-background">
      <Header audience={audience} />

      <main className="mx-auto w-full max-w-2xl px-4 pb-safe-b pt-3">
        <Suspense
          fallback={
            <div className="space-y-3 pt-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-auto flex max-w-2xl">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              // `end` on the index route only, or "Home" stays lit on every child.
              end={to === `/${audience}`}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Header({ audience }: { audience: 'parent' | 'student' | 'teacher' }) {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        {/* The crest goes back to the public website. The portal and the school
            site are one deployment, so leaving the workspace is a router link
            rather than a second address to remember. */}
        <Link to="/" className="flex min-w-0 flex-1 items-center gap-3" aria-label={`${SCHOOL_NAME} website`}>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <School className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight">{SCHOOL_NAME}</div>
            <div className="truncate text-xs text-muted-foreground">
              {user ? `${user.firstName} ${user.lastName ?? ''}`.trim() : ''}
            </div>
          </div>
        </Link>
        {audience === 'parent' && <ChildSwitcher />}
        <button
          type="button"
          aria-label="Sign out"
          className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
          onClick={() => {
            clear();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>
    </header>
  );
}

/**
 * Which child a guardian is looking at.
 *
 * Rendered only when there is a real choice. A guardian with one pupil should
 * never see a control that implies they might have more, and one with four
 * needs it on every screen rather than buried in a settings page.
 */
function ChildSwitcher() {
  const students = useAuthStore((s) => s.portal?.students ?? []);
  const activeId = useAuthStore((s) => s.activeStudentId);
  const setActive = useAuthStore((s) => s.setActiveStudent);

  if (students.length < 2) return null;

  return (
    <div className="relative">
      <select
        aria-label="Choose a child"
        className="h-10 appearance-none rounded-lg border bg-card pl-3 pr-8 text-sm font-medium"
        value={activeId ?? ''}
        onChange={(e) => setActive(e.target.value)}
      >
        {students.map((c) => (
          <option key={c.studentProfileId} value={c.studentProfileId}>
            {c.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}
