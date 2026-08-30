import { Link } from 'react-router-dom';
import {
  ArrowRight, Wallet, CalendarCheck, GraduationCap, BookOpen, ClipboardList,
  Users, ShieldCheck, Sparkles, PhoneCall, CheckCircle2,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import { NEWS, PROGRAMMES, SITE, STATS, WHY_US, PORTAL_AUDIENCES } from '@/site/content';
import {
  BrandBackdrop, Container, CtaLink, IconPlate, LinkPanel, Panel, Pill,
  Reveal, Section, SectionHeading, formatDate,
} from '@/site/components';
import { usePageTitle } from '@/site/site-shell';

/**
 * The home page.
 *
 * Ordered by what people actually come here for. Site analytics for schools are
 * boringly consistent: existing parents checking something (fees, a date, a
 * result) vastly outnumber prospective ones, and they arrive on the home page
 * anyway. So the portal doors sit directly under the hero, above the marketing —
 * a parent should reach "sign in" without scrolling on a phone, and a
 * prospective family loses nothing by meeting the school one screen later.
 */

const AUDIENCE_ICON = {
  parent: Wallet,
  student: BookOpen,
  teacher: ClipboardList,
} as const;

const WHY_ICON = [Users, GraduationCap, Wallet, ShieldCheck, Sparkles, PhoneCall];

export default function HomePage() {
  usePageTitle('Home');
  const signedIn = useAuthStore((s) => !!s.accessToken);
  const latest = NEWS.slice(0, 3);

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative isolate overflow-hidden bg-[hsl(var(--brand-deep))] text-white">
        <BrandBackdrop className="text-white" />
        <Container className="relative py-20 sm:py-28 lg:py-32">
          <div className="max-w-3xl">
            <Reveal>
              <Pill tone="onDark">
                <span className="h-1.5 w-1.5 rounded-full bg-[hsl(var(--accent))]" />
                Term 3 opens 14 September · admissions open
              </Pill>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="pt-6 font-display text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
                {SITE.tagline}
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="max-w-2xl pt-5 text-base leading-relaxed text-white/75 sm:text-lg">{SITE.intro}</p>
            </Reveal>

            <Reveal delay={180}>
              <div className="flex flex-col gap-3 pt-8 sm:flex-row sm:items-center">
                <CtaLink to={signedIn ? '/home' : '/login'} variant="onDark" className="px-7">
                  {signedIn ? 'Go to my portal' : 'Sign in to the portal'}
                  <ArrowRight className="h-4 w-4" />
                </CtaLink>
                <CtaLink
                  to="/admissions"
                  variant="ghost"
                  className="border border-white/25 text-white hover:bg-white/10"
                >
                  Apply for a place
                </CtaLink>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-10 text-sm text-white/70">
                {['Nursery to A-Level', 'Day & boarding', 'Results online', 'Fees online'].map((t) => (
                  <li key={t} className="inline-flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-[hsl(var(--accent))]" />
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </Container>

        {/* Soften the edge into the page below rather than stopping the colour dead. */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-background/10" />
      </section>

      {/* ── The portal doors ──
          Lifted out of the page flow so they overlap the hero: on a phone this
          is the first thing under the fold, which is where a returning parent's
          thumb already is. */}
      <Container className="relative z-10 -mt-10 sm:-mt-14">
        <div className="grid gap-4 sm:grid-cols-3">
          {PORTAL_AUDIENCES.map((a, i) => {
            const Icon = AUDIENCE_ICON[a.key];
            return (
              <Reveal key={a.key} delay={i * 70}>
                <LinkPanel to={signedIn ? '/home' : '/login'} className="h-full">
                  <div className="flex items-start justify-between gap-3">
                    <IconPlate>
                      <Icon className="h-5 w-5" />
                    </IconPlate>
                    <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <h3 className="pt-4 font-display text-lg font-bold tracking-tight">{a.title}</h3>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
                  <p className="pt-4 text-sm font-semibold text-primary">{signedIn ? 'Open my portal' : 'Sign in'}</p>
                </LinkPanel>
              </Reveal>
            );
          })}
        </div>
        <p className="pt-4 text-center text-sm text-muted-foreground">
          No account yet?{' '}
          <Link to="/portals" className="font-medium text-primary underline-offset-4 hover:underline">
            How portal accounts work
          </Link>
        </p>
      </Container>

      {/* ── Numbers ── */}
      <Section className="pb-8 pt-16 sm:pb-10 sm:pt-20">
        <Container>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 60}>
                <div className="rounded-2xl border bg-card p-5 text-center sm:p-6">
                  <div className="font-display text-3xl font-bold tabular-nums tracking-tight text-primary sm:text-4xl">
                    {s.value}
                  </div>
                  <div className="pt-2 text-sm font-semibold">{s.label}</div>
                  <div className="pt-0.5 text-xs text-muted-foreground">{s.sub}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Programmes ── */}
      <Section className="pt-8 sm:pt-10">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading
              eyebrow="Academics"
              title="One school, four stages"
              lede="A single campus from the first day of nursery to the last paper of A-Level, so a child never has to start again somewhere new."
            />
            <CtaLink to="/academics" variant="outline" className="shrink-0">
              All programmes <ArrowRight className="h-4 w-4" />
            </CtaLink>
          </div>

          <div className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-4">
            {PROGRAMMES.map((p, i) => (
              <Reveal key={p.key} delay={i * 60}>
                <LinkPanel to="/academics" className="h-full">
                  <Pill tone="brand">{p.ages}</Pill>
                  <h3 className="pt-4 font-display text-xl font-bold tracking-tight">{p.name}</h3>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
                </LinkPanel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Why ── */}
      <Section tone="muted">
        <Container>
          <SectionHeading
            eyebrow="Why families choose us"
            title="The things that actually change a term"
            lede="Not a list of facilities. The six things a guardian notices in the first month."
            align="center"
          />
          <div className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_US.map((w, i) => {
              const Icon = WHY_ICON[i % WHY_ICON.length];
              return (
                <Reveal key={w.title} delay={i * 50}>
                  <Panel className="h-full">
                    <IconPlate>
                      <Icon className="h-5 w-5" />
                    </IconPlate>
                    <h3 className="pt-4 font-semibold">{w.title}</h3>
                    <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
                  </Panel>
                </Reveal>
              );
            })}
          </div>
        </Container>
      </Section>

      {/* ── News ── */}
      <Section>
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading eyebrow="Latest" title="News & notices" />
            <CtaLink to="/news" variant="outline" className="shrink-0">
              All news <ArrowRight className="h-4 w-4" />
            </CtaLink>
          </div>

          <div className="grid gap-4 pt-12 lg:grid-cols-3">
            {latest.map((n, i) => (
              <Reveal key={n.slug} delay={i * 60}>
                <LinkPanel to={`/news/${n.slug}`} className="flex h-full flex-col">
                  <div className="flex items-center gap-3">
                    <Pill tone={n.category === 'Achievement' ? 'accent' : 'brand'}>{n.category}</Pill>
                    <time className="text-xs text-muted-foreground" dateTime={n.date}>
                      {formatDate(n.date)}
                    </time>
                  </div>
                  <h3 className="pt-4 font-display text-lg font-bold leading-snug tracking-tight">{n.title}</h3>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{n.excerpt}</p>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-primary">
                    Read more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </LinkPanel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Closing call ── */}
      <Section className="pb-20 pt-0">
        <Container>
          <div className="relative isolate overflow-hidden rounded-3xl bg-[hsl(var(--brand-deep))] px-6 py-14 text-white sm:px-12 sm:py-16">
            <BrandBackdrop className="text-white" />
            <div className="relative max-w-2xl">
              <SectionHeading
                invert
                eyebrow="Admissions"
                title="Places are open for Term 1, 2027"
                lede="Tours run on weekday mornings during term. Come and see an ordinary school day, then decide."
              />
              <div className="flex flex-col gap-3 pt-8 sm:flex-row">
                <CtaLink to="/admissions" variant="onDark" className="px-7">
                  How to apply <ArrowRight className="h-4 w-4" />
                </CtaLink>
                <CtaLink
                  to={`tel:${SITE.contact.phone.replace(/\s/g, '')}`}
                  variant="ghost"
                  className="border border-white/25 text-white hover:bg-white/10"
                >
                  <PhoneCall className="h-4 w-4" /> {SITE.contact.phone}
                </CtaLink>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Term dates strip ── */}
      <Container className="pb-20">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 rounded-2xl border bg-muted/40 px-6 py-4 text-sm">
          <span className="inline-flex items-center gap-2 font-semibold">
            <CalendarCheck className="h-4 w-4 text-primary" /> Term 3, 2026
          </span>
          <span className="text-muted-foreground">Opens 14 September · Closes 4 December</span>
          <Link to="/academics#calendar" className="font-medium text-primary underline-offset-4 hover:underline">
            Full calendar
          </Link>
        </div>
      </Container>
    </>
  );
}
