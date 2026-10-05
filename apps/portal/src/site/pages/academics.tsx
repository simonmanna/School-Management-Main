import { ArrowRight, CalendarDays, Check, Clock } from 'lucide-react';
import { ACTIVITIES, FACILITIES, PROGRAMMES, TERM_DATES } from '@/site/content';
import {
  Container, CtaLink, IconPlate, Panel, Photo, Pill, Reveal, Section, SectionHeading,
} from '@/site/components';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';

/** A normal day, in the order it happens. Parents ask for this more than any curriculum detail. */
const SCHOOL_DAY = [
  { time: '7:20', label: 'Gates close', note: 'Day pupils registered in class' },
  { time: '7:30', label: 'Assembly / class register', note: 'Attendance taken and posted to the portal' },
  { time: '8:00', label: 'Lessons, periods 1–4', note: '40-minute periods with a mid-morning break' },
  { time: '13:00', label: 'Lunch', note: 'Hot meal on site for every pupil' },
  { time: '14:00', label: 'Lessons, periods 5–8', note: 'Practicals timetabled in the afternoon block' },
  { time: '16:00', label: 'Clubs and games', note: 'Every pupil takes at least one activity' },
  { time: '17:00', label: 'Day pupils leave', note: 'Boarders go to supervised prep at 19:00' },
];


export default function AcademicsPage() {
  usePageTitle('Academics');

  return (
    <>
      <PageHero
        eyebrow="Academics"
        title="Nursery to A-Level on one campus"
        image="olevel-lesson"
        lede="The national curriculum, taught in classes small enough to notice an individual child, and examined honestly enough that the report card means something."
      />

      {/* ── Programmes ── */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Programmes"
            title="Four stages"
            lede="A pupil can arrive at three years old and leave at eighteen without ever changing school."
          />
          <div className="grid gap-4 pt-12 sm:grid-cols-2">
            {PROGRAMMES.map((p, i) => (
              <Reveal key={p.key} delay={i * 60}>
                <Panel className="h-full overflow-hidden p-0">
                  <Photo photo={p.photo} className="aspect-[16/9]" sizes="(min-width: 640px) 50vw, 100vw" />
                  <div className="p-6">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="font-display text-2xl font-bold tracking-tight">{p.name}</h3>
                      <Pill tone="brand">{p.ages}</Pill>
                    </div>
                    <p className="pt-3 text-sm leading-relaxed text-muted-foreground">{p.summary}</p>
                    <ul className="grid gap-2 pt-5 sm:grid-cols-2">
                      {p.highlights.map((h) => (
                        <li key={h} className="flex items-start gap-2 text-sm">
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Panel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {/* ── The school day ── */}
      <Section tone="muted">
        <Container>
          <div className="grid gap-12 lg:grid-cols-[1fr_1.2fr] lg:gap-16">
            <div>
              <SectionHeading
                eyebrow="A normal day"
                title="What happens between the gates"
                lede="Attendance is taken at registration and again every period. A pupil who is missing from a lesson is a phone call, not a note at the end of term."
              />
              <div className="pt-8">
                <CtaLink to="/admissions" variant="outline">
                  Admissions <ArrowRight className="h-4 w-4" />
                </CtaLink>
              </div>
            </div>

            <ol className="relative space-y-1 border-l pl-6">
              {SCHOOL_DAY.map((s, i) => (
                <Reveal key={s.time} delay={i * 40}>
                  <li className="relative py-3">
                    <span className="absolute -left-[1.9rem] top-4 flex h-3 w-3 items-center justify-center rounded-full bg-primary ring-4 ring-[hsl(var(--muted))]" />
                    <div className="flex flex-wrap items-baseline gap-x-3">
                      <span className="font-display text-lg font-bold tabular-nums text-primary">{s.time}</span>
                      <span className="font-semibold">{s.label}</span>
                    </div>
                    <p className="pt-0.5 text-sm text-muted-foreground">{s.note}</p>
                  </li>
                </Reveal>
              ))}
            </ol>
          </div>
        </Container>
      </Section>

      {/* ── Facilities ── */}
      <Section>
        <Container>
          <SectionHeading
            eyebrow="Beyond the classroom"
            title="What the campus holds"
            lede="Everything a pupil needs between the first bell and evening prep, inside one gate."
            align="center"
          />
          <div className="grid gap-4 pt-12 sm:grid-cols-2 lg:grid-cols-3">
            {FACILITIES.map((f, i) => (
              <Reveal key={f.title} delay={i * 60}>
                <Panel className="h-full overflow-hidden p-0">
                  <Photo
                    photo={f.photo}
                    className="aspect-[3/2]"
                    sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                  />
                  <div className="p-6">
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                </Panel>
              </Reveal>
            ))}
          </div>

          <div className="mt-16 grid items-center gap-10 rounded-3xl border bg-muted/40 p-6 sm:p-10 lg:grid-cols-[1.3fr_1fr]">
            <div>
              <SectionHeading
                eyebrow="Clubs & activities"
                title="Every pupil takes at least one"
                lede="Clubs run from 4:00 pm every weekday, with fixtures and performances on Saturdays."
              />
              <ul className="flex flex-wrap gap-2 pt-6">
                {ACTIVITIES.map((a) => (
                  <li key={a}>
                    <Pill tone="brand">{a}</Pill>
                  </li>
                ))}
              </ul>
            </div>
            <Photo
              photo="football"
              className="aspect-[4/3] rounded-2xl"
              imgClassName="object-[center_35%]"
              sizes="(min-width: 1024px) 420px, 100vw"
            />
          </div>
        </Container>
      </Section>

      {/* ── Calendar ──
          `id` is linked from the home page strip, so it must stay stable. */}
      <Section tone="muted" id="calendar" className="scroll-mt-24">
        <Container>
          <SectionHeading
            eyebrow="Calendar"
            title="Term dates"
            lede="Published a year ahead. Boarders report the afternoon before each opening day."
          />
          <div className="grid gap-4 pt-12 sm:grid-cols-3">
            {TERM_DATES.map((t, i) => (
              <Reveal key={t.term} delay={i * 60}>
                <Panel className="h-full">
                  <IconPlate>
                    <CalendarDays className="h-5 w-5" />
                  </IconPlate>
                  <h3 className="pt-4 font-display text-lg font-bold tracking-tight">{t.term}</h3>
                  <dl className="space-y-1.5 pt-3 text-sm">
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Opens</dt>
                      <dd className="font-medium">{t.opens}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted-foreground">Closes</dt>
                      <dd className="font-medium">{t.closes}</dd>
                    </div>
                  </dl>
                  {t.note && (
                    <p className="mt-4 inline-flex items-start gap-2 rounded-lg bg-accent/10 px-3 py-2 text-xs text-foreground">
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[hsl(var(--accent))]" />
                      {t.note}
                    </p>
                  )}
                </Panel>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}
