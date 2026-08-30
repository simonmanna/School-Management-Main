import * as React from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * Public-site primitives.
 *
 * Separate from `components/ui.tsx` on purpose. Those are sized for a signed-in
 * parent holding a phone: 44px targets, dense cards, no decoration. A public
 * page is doing a different job — it has to look like a school worth applying
 * to before anyone reads a word — so it gets wide sections, a display type
 * scale and some ornament. Mixing the two vocabularies in one file is how a
 * design system stops meaning anything.
 */

/* ── Layout ── */

export function Container({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mx-auto w-full max-w-6xl px-5 sm:px-8', className)} {...props} />;
}

export function Section({
  className,
  tone = 'default',
  ...props
}: React.HTMLAttributes<HTMLElement> & { tone?: 'default' | 'muted' | 'brand' }) {
  return (
    <section
      className={cn(
        'py-16 sm:py-24',
        tone === 'muted' && 'bg-muted/50',
        tone === 'brand' && 'bg-[hsl(var(--brand-deep))] text-white',
        className,
      )}
      {...props}
    />
  );
}

/** The label / heading / lede stack that opens most sections. */
export function SectionHeading({
  eyebrow,
  title,
  lede,
  align = 'left',
  invert = false,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  align?: 'left' | 'center';
  invert?: boolean;
}) {
  return (
    <div className={cn('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      {eyebrow && (
        <p
          className={cn(
            'text-xs font-semibold uppercase tracking-[0.18em]',
            invert ? 'text-white/70' : 'text-primary',
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          'font-display text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl',
          eyebrow && 'pt-3',
          invert && 'text-white',
        )}
      >
        {title}
      </h2>
      {lede && (
        <p className={cn('pt-4 text-base leading-relaxed sm:text-lg', invert ? 'text-white/75' : 'text-muted-foreground')}>
          {lede}
        </p>
      )}
    </div>
  );
}

/* ── Buttons that are links ──
   The portal's `Button` renders a <button>; navigation needs an anchor so that
   middle-click, cmd-click and "copy link address" all behave. */

type CtaVariant = 'primary' | 'outline' | 'ghost' | 'onDark';

const CTA_VARIANTS: Record<CtaVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  outline: 'border border-border bg-card text-foreground hover:bg-muted',
  ghost: 'text-foreground hover:bg-muted',
  onDark: 'bg-white text-[hsl(var(--brand-deep))] hover:bg-white/90 shadow-sm',
};

const CTA_BASE =
  'inline-flex items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors ' +
  'min-h-[2.75rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function CtaLink({
  to,
  variant = 'primary',
  className,
  children,
  ...props
}: { to: string; variant?: CtaVariant } & Omit<React.ComponentProps<typeof Link>, 'to'>) {
  // External and mail links must not go through the router.
  const external = /^(https?:|mailto:|tel:)/.test(to);
  if (external) {
    return (
      <a
        href={to}
        className={cn(CTA_BASE, CTA_VARIANTS[variant], className)}
        rel="noreferrer"
        target={to.startsWith('http') ? '_blank' : undefined}
      >
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={cn(CTA_BASE, CTA_VARIANTS[variant], className)} {...props}>
      {children}
    </Link>
  );
}

/* ── Surfaces ── */

export function Panel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md', className)}
      {...props}
    />
  );
}

/** A card that is entirely a link. */
export function LinkPanel({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        'group block rounded-2xl border bg-card p-6 shadow-sm transition-all',
        'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function Pill({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'brand' | 'onDark' | 'accent';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold',
        tone === 'default' && 'bg-muted text-muted-foreground',
        tone === 'brand' && 'bg-secondary text-secondary-foreground',
        tone === 'accent' && 'bg-accent/15 text-[hsl(var(--accent))]',
        tone === 'onDark' && 'bg-white/15 text-white ring-1 ring-inset ring-white/20',
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The icon plate used on feature and programme cards.
 *
 * A single component so the corner radius, size and colour never drift apart
 * across six pages that each wanted "the little green square".
 */
export function IconPlate({
  children,
  tone = 'brand',
  className,
}: {
  children: React.ReactNode;
  tone?: 'brand' | 'accent' | 'onDark';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
        tone === 'brand' && 'bg-secondary text-[hsl(var(--primary))]',
        tone === 'accent' && 'bg-accent/15 text-[hsl(var(--accent))]',
        tone === 'onDark' && 'bg-white/10 text-white ring-1 ring-inset ring-white/15',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Motion ──
   `prefers-reduced-motion` is honoured in index.css, which disables the
   animation rather than this component: the element must still become visible. */

export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (an old browser, or a test environment): show it.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    io.observe(el);

    // Failsafe. An observer that never fires — a zero-height ancestor mid-layout,
    // a headless renderer, a browser quirk — would otherwise leave this content
    // permanently invisible. Two seconds late is a missed animation; never is a
    // blank page.
    const failsafe = window.setTimeout(() => setShown(true), 2000);

    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn('reveal', shown && 'reveal-in', className)}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * The background behind dark sections and the hero.
 *
 * Drawn rather than photographed. A school site normally leans on stock
 * photography, and shipping a 400 KB hero image to a parent on mobile data to
 * decorate a page they opened to find a phone number is the wrong trade. This
 * is a few hundred bytes of SVG and gradient.
 */
export function BrandBackdrop({ className }: { className?: string }) {
  // The home page draws this twice (hero and closing band). A hard-coded pattern
  // id would be duplicated in the document, and every `url(#…)` in the page would
  // resolve to whichever copy happened to render first.
  const patternId = React.useId().replace(/:/g, '') + '-grid';

  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
      {/* Two radial gradients rather than two blurred divs. A `blur-3xl` circle
          is a real filter pass on every composite, which a mid-range Android
          phone pays for on a page it will scroll — a gradient costs nothing and
          is indistinguishable at this softness. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(38rem 28rem at 8% -10%, hsl(var(--primary) / 0.35), transparent 70%),' +
            'radial-gradient(30rem 24rem at 96% 18%, hsl(var(--accent) / 0.22), transparent 68%)',
        }}
      />
      <svg className="absolute inset-0 h-full w-full opacity-[0.07]" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id={patternId} width="32" height="32" patternUnits="userSpaceOnUse">
            <path d="M32 0H0v32" fill="none" stroke="currentColor" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}

/** The school crest. An inline mark, so there is no logo file to go missing. */
export function Crest({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} fill="none" aria-hidden>
      <path
        d="M20 3.5 34 9v11.2c0 8-5.7 14.2-14 16.8-8.3-2.6-14-8.8-14-16.8V9l14-5.5Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M20 3.5 34 9v11.2c0 8-5.7 14.2-14 16.8-8.3-2.6-14-8.8-14-16.8V9l14-5.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path d="M12.5 19.5 18 25l10-11" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Formatting ── */

/** Dates are written the way a Ugandan school writes them: 14 September 2026. */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
