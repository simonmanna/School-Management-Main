import { Link } from 'react-router-dom';
import {
  ArrowRight, Wallet, CalendarCheck, GraduationCap, BookOpen, ClipboardList,
  Users, ShieldCheck, Sparkles, PhoneCall, CheckCircle2, Quote, Images,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth.store';
import {
  FACILITIES, GALLERY, HEAD_MESSAGE, NEWS, PROGRAMMES, SITE, STATS, TESTIMONIALS, WHY_US, PORTAL_AUDIENCES,
} from '@/site/content';
import {
  BrandBackdrop, Container, CtaLink, IconPlate, LinkPanel, Panel, Photo, Pill,
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
 *
 * Below the doors the page is for the prospective family, and leans on
 * photographs: a parent choosing a school wants to see the classrooms and the
 * children in them before they read a word about pastoral care.
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
  const strip = GALLERY.slice(0, 6);

  return (
    <>
      {/* ── Hero ── */}
      <section className="relative isolate overflow-hidden bg-[hsl(var(--brand-deep))] text-white">
        <Photo
          photo="hero-classroom"
          alt=""
          priority
          sizes="100vw"
          className="absolute inset-0 -z-10 bg-transparent"
          imgClassName="object-[center_30%]"
        />
        {/* Heavier on the left where the type sits; the photo shows through on the right. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-[hsl(var(--brand-deep)/0.96)] via-[hsl(var(--brand-deep)/0.8)] to-[hsl(var(--brand-deep)/0.35)]"
        />
        <BrandBackdrop className="text-white" />
        <Container className="relative pb-28 pt-20 sm:pb-36 sm:pt-28 lg:pb-40 lg:pt-32">
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
              <p className="max-w-2xl pt-5 text-base leading-relaxed text-white/80 sm:text-lg">{SITE.intro}</p>
            </Reveal>

            <Reveal delay={180}>
              <div className="flex flex-col gap-3 pt-8 sm:flex-row sm:items-center">
                <CtaLink to="/admissions" variant="onDark" className="px-7">
                  Apply for a place
                  <ArrowRight className="h-4 w-4" />
                </CtaLink>
                <CtaLink
                  to="/contact"
                  variant="ghost"
                  className="border border-white/30 text-white hover:bg-white/10"
                >
                  Book a school visit
                </CtaLink>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <ul className="flex flex-wrap gap-x-6 gap-y-2 pt-10 text-sm text-white/80">
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
      </section>

      {/* ── The portal doors ──
          Lifted out of the page flow so they overlap the hero: on a phone this
          is the first thing under the fold, which is where a returning parent's
          thumb already is. */}
      <Container className="relative z-10 -mt-16 sm:-mt-20">
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

      {/* ── Welcome from the head ── */}
      <Section className="pt-12 sm:pt-16">
        <Container>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <div className="relative">
                <Photo
                  photo={HEAD_MESSAGE.photo}
                  className="aspect-[4/3] rounded-3xl shadow-lg"
                  sizes="(min-width: 1024px) 560px, 100vw"
                />
                <div className="absolute -bottom-6 right-4 hidden rounded-2xl border bg-card px-5 py-4 shadow-lg sm:block">
                  <p className="font-display text-2xl font-bold text-primary">Since {SITE.foundedYear}</p>
                  <p className="text-xs text-muted-foreground">One campus, nursery to A-Level</p>
                </div>
              </div>
            </Reveal>
            <Reveal delay={80}>
              <div>
                <SectionHeading eyebrow="Welcome" title="A word from the head" />
                <div className="space-y-4 pt-6 text-base leading-relaxed text-muted-foreground">
                  {HEAD_MESSAGE.paragraphs.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
                <div className="pt-6">
                  <p className="font-display text-lg font-bold">{HEAD_MESSAGE.name}</p>
                  <p className="text-sm text-muted-foreground">{HEAD_MESSAGE.role}</p>
                </div>
                <div className="pt-6">
                  <CtaLink to="/about" variant="outline">
                    About the school <ArrowRight className="h-4 w-4" />
                  </CtaLink>
                </div>
              </div>
            </Reveal>
          </div>
        </Container>
      </Section>

      {/* ── Programmes ── */}
      <Section tone="muted">
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
                <LinkPanel to="/academics" className="flex h-full flex-col overflow-hidden p-0">
                  <Photo
                    photo={p.photo}
                    className="aspect-[4/3]"
                    imgClassName="transition-transform duration-500 group-hover:scale-105"
                    sizes="(min-width: 1024px) 280px, (min-width: 640px) 50vw, 100vw"
                  />
                  <div className="flex flex-1 flex-col p-6">
                    <Pill tone="brand" className="self-start">{p.ages}</Pill>
                    <h3 className="pt-4 font-display text-xl font-bold tracking-tight">{p.name}</h3>
                    <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
                  </div>
                </LinkPanel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Why ── */}
      <Section>
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

      {/* ── Campus life ── */}
      <Section tone="brand" className="relative isolate overflow-hidden">
        <BrandBackdrop className="text-white" />
        <Container className="relative">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading
              invert
              eyebrow="Campus life"
              title="Where the day happens"
              lede="Classrooms, laboratories, a library, playing fields and boarding houses — all on one gated campus."
            />
            <CtaLink to="/gallery" variant="onDark" className="shrink-0">
              <Images className="h-4 w-4" /> Photo gallery
            </CtaLink>
          </div>
          <div className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {FACILITIES.map((f, i) => (
              <Reveal key={f.title} delay={i * 50}>
                <figure className="group relative h-72 overflow-hidden rounded-2xl">
                  <Photo
                    photo={f.photo}
                    className="absolute inset-0"
                    imgClassName="transition-transform duration-700 group-hover:scale-105"
                    sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                  />
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
                  />
                  <figcaption className="absolute inset-x-0 bottom-0 p-5">
                    <h3 className="font-display text-lg font-bold">{f.title}</h3>
                    <p className="pt-1 text-sm leading-relaxed text-white/80">{f.body}</p>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Testimonials ── */}
      <Section>
        <Container>
          <SectionHeading
            align="center"
            eyebrow="In their words"
            title="What families and former pupils say"
          />
          <div className="grid gap-4 pt-12 lg:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 70}>
                <figure className="flex h-full flex-col rounded-2xl border bg-card p-7 shadow-sm">
                  <Quote className="h-8 w-8 text-primary/30" aria-hidden />
                  <blockquote className="flex-1 pt-4 text-base leading-relaxed">“{t.quote}”</blockquote>
                  <figcaption className="pt-6">
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-sm text-muted-foreground">{t.role}</p>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── News ── */}
      <Section tone="muted">
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
                <LinkPanel to={`/news/${n.slug}`} className="flex h-full flex-col overflow-hidden p-0">
                  <Photo
                    photo={n.photo}
                    className="aspect-[16/9]"
                    imgClassName="transition-transform duration-500 group-hover:scale-105"
                    sizes="(min-width: 1024px) 380px, 100vw"
                  />
                  <div className="flex flex-1 flex-col p-6">
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
                  </div>
                </LinkPanel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Gallery strip ── */}
      <Section className="pb-12 sm:pb-16">
        <Container>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <SectionHeading eyebrow="Gallery" title="A look around" />
            <CtaLink to="/gallery" variant="outline" className="shrink-0">
              See all photos <ArrowRight className="h-4 w-4" />
            </CtaLink>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-10 sm:grid-cols-3 lg:grid-cols-6">
            {strip.map((g, i) => (
              <Reveal key={g.photo} delay={i * 40}>
                <Link
                  to="/gallery"
                  className="group block overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Photo
                    photo={g.photo}
                    alt={g.caption}
                    className="aspect-square"
                    imgClassName="transition-transform duration-500 group-hover:scale-110"
                    sizes="(min-width: 1024px) 190px, (min-width: 640px) 33vw, 50vw"
                  />
                </Link>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Closing call ── */}
      <Section className="pb-20 pt-0">
        <Container>
          <div className="relative isolate overflow-hidden rounded-3xl bg-[hsl(var(--brand-deep))] px-6 py-14 text-white sm:px-12 sm:py-20">
            <Photo
              photo="graduation"
              alt=""
              className="absolute inset-0 -z-10 bg-transparent"
              sizes="(min-width: 1152px) 1100px, 100vw"
            />
            <div
              aria-hidden
              className="absolute inset-0 -z-10 bg-gradient-to-r from-[hsl(var(--brand-deep)/0.97)] via-[hsl(var(--brand-deep)/0.85)] to-[hsl(var(--brand-deep)/0.4)]"
            />
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
                  className="border border-white/30 text-white hover:bg-white/10"
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
