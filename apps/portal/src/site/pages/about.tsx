import { ArrowRight, Compass, HeartHandshake, Target } from 'lucide-react';
import { LEADERSHIP, SITE, STATS, WHY_US } from '@/site/content';
import {
  BrandBackdrop, Container, CtaLink, IconPlate, Panel, Reveal, Section, SectionHeading,
} from '@/site/components';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';

const VALUES = [
  {
    icon: Target,
    title: 'Knowledge',
    body: 'Taught properly, examined honestly, reported the same week. A mark on this portal is the mark in the register.',
  },
  {
    icon: HeartHandshake,
    title: 'Character',
    body: 'A named class teacher, a house, and adults who notice when a child goes quiet. Pastoral care is on the timetable, not in a policy folder.',
  },
  {
    icon: Compass,
    title: 'Service',
    body: 'Every pupil joins a club and every senior class runs a community project. Leaving well means leaving useful.',
  },
];

export default function AboutPage() {
  usePageTitle('About');

  return (
    <>
      <PageHero
        eyebrow="About us"
        title={`A school built around the child, not the timetable`}
        lede={`${SITE.name} has taught in Kampala since ${SITE.foundedYear}. One campus, nursery to A-Level, day and boarding — small enough that the head knows the pupils, large enough to run three science laboratories and a full games programme.`}
      />

      {/* ── Story ── */}
      <Section>
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
            <div>
              <SectionHeading eyebrow="Our story" title="Twenty-eight years in one place" />
              <div className="space-y-4 pt-6 text-base leading-relaxed text-muted-foreground">
                <p>
                  The school opened in {SITE.foundedYear} with two nursery classes in a rented house on Kira Road. The
                  first P1 cohort was eleven children. The parents who enrolled them wanted something specific: a school
                  where a teacher could name every child in the room, and where a question asked at the gate got an
                  answer the same day.
                </p>
                <p>
                  That has stayed the constraint on every decision since. Classes grew in number rather than in size.
                  Secondary opened in 2006 because the P7 leavers had nowhere near enough good places to go to, and
                  A-Level followed in 2011 for the same reason.
                </p>
                <p>
                  Today around 1,240 pupils are enrolled from nursery through S6, taught by a staff of just over
                  seventy. The buildings have changed. The rule that a guardian gets an answer within two working days
                  has not.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {STATS.map((s, i) => (
                <Reveal key={s.label} delay={i * 60}>
                  <div className="flex items-baseline justify-between gap-4 rounded-2xl border bg-card px-6 py-5">
                    <div>
                      <div className="font-semibold">{s.label}</div>
                      <div className="pt-0.5 text-xs text-muted-foreground">{s.sub}</div>
                    </div>
                    <div className="font-display text-3xl font-bold tabular-nums text-primary">{s.value}</div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </Container>
      </Section>

      {/* ── Values ── */}
      <Section tone="muted">
        <Container>
          <SectionHeading
            align="center"
            eyebrow="Our motto"
            title={SITE.motto}
            lede="Three words on the crest, and what each of them costs us to mean."
          />
          <div className="grid gap-4 pt-12 sm:grid-cols-3">
            {VALUES.map((v, i) => (
              <Reveal key={v.title} delay={i * 70}>
                <Panel className="h-full">
                  <IconPlate>
                    <v.icon className="h-5 w-5" />
                  </IconPlate>
                  <h3 className="pt-4 font-display text-xl font-bold tracking-tight">{v.title}</h3>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{v.body}</p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── Leadership ── */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Leadership"
            title="Who to ask"
            lede="Four offices cover almost everything a family needs. The switchboard will put you through to the right one."
          />
          <div className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-4">
            {LEADERSHIP.map((p, i) => (
              <Reveal key={p.name} delay={i * 60}>
                <Panel className="h-full">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary font-display text-lg font-bold text-[hsl(var(--primary))]">
                    {p.name
                      .split(/[\s,]+/)
                      .slice(0, 2)
                      .map((w) => w[0])
                      .join('')}
                  </div>
                  <h3 className="pt-4 font-semibold leading-tight">{p.name}</h3>
                  <p className="pt-1 text-xs font-semibold uppercase tracking-wide text-primary">{p.role}</p>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{p.blurb}</p>
                </Panel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── What families notice ── */}
      <Section tone="muted">
        <Container>
          <SectionHeading eyebrow="In practice" title="What families notice" align="center" />
          <div className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_US.map((w, i) => (
              <Reveal key={w.title} delay={i * 50}>
                <div className="h-full rounded-2xl border-l-2 border-primary/40 bg-card px-6 py-5">
                  <h3 className="font-semibold">{w.title}</h3>
                  <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{w.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      <Section className="pt-0">
        <Container>
          <div className="relative isolate overflow-hidden rounded-3xl bg-[hsl(var(--brand-deep))] px-6 py-14 text-white sm:px-12">
            <BrandBackdrop className="text-white" />
            <div className="relative max-w-2xl">
              <SectionHeading invert title="Come and see an ordinary Tuesday" lede="Tours are by appointment, on weekday mornings during term." />
              <div className="flex flex-col gap-3 pt-8 sm:flex-row">
                <CtaLink to="/contact" variant="onDark" className="px-7">
                  Book a visit <ArrowRight className="h-4 w-4" />
                </CtaLink>
                <CtaLink to="/admissions" variant="ghost" className="border border-white/25 text-white hover:bg-white/10">
                  Admissions
                </CtaLink>
              </div>
            </div>
          </div>
        </Container>
      </Section>
    </>
  );
}
