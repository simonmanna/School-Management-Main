import { useEffect, useState, Suspense } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Menu, X, Phone, Mail, MapPin, ArrowRight, LogIn, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { SITE } from '@/site/content';
import { Container, Crest, CtaLink } from '@/site/components';

/**
 * The public website's chrome.
 *
 * This is the same deployment as the portal, not a separate marketing site, and
 * that is the point of the whole exercise: the "Sign in" button in this header
 * is a router link to `/login`, so a parent who arrives from a search result and
 * a parent who typed the portal URL end up in the same place with no redirect
 * between origins and no second session to keep straight.
 *
 * The header therefore has to know whether someone is already signed in. It
 * reads the persisted token — not to authorize anything (the guards and the API
 * do that), only to decide whether the button should say "Sign in" or take them
 * back to their own workspace.
 */

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/about', label: 'About' },
  { to: '/academics', label: 'Academics' },
  { to: '/admissions', label: 'Admissions' },
  { to: '/news', label: 'News' },
  { to: '/contact', label: 'Contact' },
];

export function SiteShell() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <Suspense
          fallback={
            <Container className="space-y-4 py-16">
              <Skeleton className="h-10 w-2/3" />
              <Skeleton className="h-64 w-full" />
            </Container>
          }
        >
          <Outlet />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();
  const signedIn = useAuthStore((s) => !!s.accessToken);

  // Close the drawer on navigation, or the menu stays open over the new page.
  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // An open drawer must not scroll the page behind it.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 transition-colors duration-200',
        scrolled || open ? 'border-b bg-card/90 backdrop-blur-md' : 'border-b border-transparent bg-card/60 backdrop-blur',
      )}
    >
      {/* Contact strip. A school's phone number is the most-clicked thing on the
          site and does not deserve to be three pages deep. */}
      <div className="hidden bg-[hsl(var(--brand-deep))] text-white lg:block">
        <Container className="flex h-9 items-center justify-between text-xs">
          <div className="flex items-center gap-5">
            <a href={`tel:${SITE.contact.phone.replace(/\s/g, '')}`} className="inline-flex items-center gap-1.5 hover:underline">
              <Phone className="h-3.5 w-3.5" /> {SITE.contact.phone}
            </a>
            <a href={`mailto:${SITE.contact.email}`} className="inline-flex items-center gap-1.5 hover:underline">
              <Mail className="h-3.5 w-3.5" /> {SITE.contact.email}
            </a>
          </div>
          <div className="flex items-center gap-4 text-white/80">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {SITE.contact.addressLines[0]}
            </span>
            <Link to="/verify" className="hover:underline">
              Verify a certificate
            </Link>
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex h-16 items-center gap-3 sm:h-[4.5rem]">
          <Link to="/" className="flex min-w-0 items-center gap-2.5" aria-label={`${SITE.name} home`}>
            <Crest className="h-9 w-9 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block truncate font-display text-base font-bold leading-tight tracking-tight sm:text-lg">
                {SITE.name}
              </span>
              <span className="hidden text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:block">
                {SITE.motto}
              </span>
            </span>
          </Link>

          <nav className="ml-auto hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                    isActive ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-3">
            <PortalButton signedIn={signedIn} className="hidden sm:inline-flex" />
            <button
              type="button"
              className="-mr-2 rounded-lg p-2 text-foreground lg:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </Container>

      {open && (
        <div className="border-t bg-card lg:hidden">
          <Container className="py-3">
            <nav className="flex flex-col">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center justify-between rounded-lg px-3 py-3 text-base font-medium',
                      isActive ? 'bg-secondary text-secondary-foreground' : 'text-foreground',
                    )
                  }
                >
                  {item.label}
                  <ArrowRight className="h-4 w-4 opacity-40" />
                </NavLink>
              ))}
              <NavLink to="/verify" className="flex items-center justify-between rounded-lg px-3 py-3 text-base font-medium text-foreground">
                Verify a certificate
                <ArrowRight className="h-4 w-4 opacity-40" />
              </NavLink>
            </nav>
            <div className="flex flex-col gap-2 px-1 pt-3">
              <PortalButton signedIn={signedIn} className="w-full" />
              <a
                href={`tel:${SITE.contact.phone.replace(/\s/g, '')}`}
                className="inline-flex min-h-[2.75rem] w-full items-center justify-center gap-2 rounded-full border text-sm font-semibold"
              >
                <Phone className="h-4 w-4" /> {SITE.contact.phone}
              </a>
            </div>
          </Container>
        </div>
      )}
    </header>
  );
}

/**
 * The one control that joins the website to the portal.
 *
 * Signed out it goes to `/login`; signed in it goes to `/home`, which is the
 * redirect that asks the server which workspace this account belongs in. The
 * website never guesses that itself — a guardian who is also a teacher would be
 * sent to the wrong one half the time.
 */
function PortalButton({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <CtaLink to={signedIn ? '/home' : '/login'} variant="primary" className={cn('px-5', className)}>
      {signedIn ? <LayoutDashboard className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
      {signedIn ? 'My portal' : 'Sign in'}
    </CtaLink>
  );
}

function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto bg-[hsl(var(--brand-deep))] text-white">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2 lg:pr-10">
            <div className="flex items-center gap-2.5">
              <Crest className="h-9 w-9 text-white" />
              <span className="font-display text-lg font-bold tracking-tight">{SITE.name}</span>
            </div>
            <p className="max-w-sm pt-4 text-sm leading-relaxed text-white/70">{SITE.intro}</p>
            <p className="pt-4 text-xs font-semibold uppercase tracking-[0.16em] text-white/50">{SITE.motto}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Explore</h3>
            <ul className="space-y-2.5 pt-4 text-sm text-white/70">
              {NAV.filter((n) => n.to !== '/').map((n) => (
                <li key={n.to}>
                  <Link to={n.to} className="hover:text-white hover:underline">
                    {n.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/portals" className="hover:text-white hover:underline">
                  Portal guide
                </Link>
              </li>
              <li>
                <Link to="/verify" className="hover:text-white hover:underline">
                  Verify a certificate
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-sm font-semibold">Contact</h3>
            <ul className="space-y-2.5 pt-4 text-sm text-white/70">
              <li className="flex gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{SITE.contact.addressLines.join(', ')}</span>
              </li>
              <li className="flex gap-2.5">
                <Phone className="mt-0.5 h-4 w-4 shrink-0" />
                <a className="hover:text-white hover:underline" href={`tel:${SITE.contact.phone.replace(/\s/g, '')}`}>
                  {SITE.contact.phone}
                </a>
              </li>
              <li className="flex gap-2.5">
                <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                <a className="break-all hover:text-white hover:underline" href={`mailto:${SITE.contact.email}`}>
                  {SITE.contact.email}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/15 pt-6 text-xs text-white/55 sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {SITE.name}. All rights reserved.
          </p>
          <p>
            Portal accounts are issued by the school office. Never share your password —{' '}
            <Link to="/login" className="font-medium text-white/80 underline underline-offset-2 hover:text-white">
              sign in here
            </Link>
            .
          </p>
        </div>
      </Container>
    </footer>
  );
}

/** Give each public page its own document title. */
export function usePageTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = `${title} · ${SITE.name}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

/** Public pages must open at the top; the router keeps the previous scroll otherwise. */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [pathname]);
  return null;
}
