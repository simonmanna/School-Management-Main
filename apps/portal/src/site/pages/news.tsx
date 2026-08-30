import { useState } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { NEWS, TERM_DATES, type NewsItem } from '@/site/content';
import {
  Container, LinkPanel, Panel, Pill, Reveal, Section, SectionHeading, formatDate,
} from '@/site/components';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';
import { cn } from '@/lib/utils';

const FILTERS = ['All', 'News', 'Notice', 'Event', 'Achievement'] as const;
type Filter = (typeof FILTERS)[number];

export default function NewsPage() {
  usePageTitle('News & events');
  const [filter, setFilter] = useState<Filter>('All');

  const items = filter === 'All' ? NEWS : NEWS.filter((n) => n.category === filter);
  const [lead, ...rest] = items;

  return (
    <>
      <PageHero
        eyebrow="News & events"
        title="What is happening at school"
        lede="Term notices, results, events and the occasional piece of good news. Anything urgent also goes to guardians by SMS and to the portal."
      />

      <Section>
        <Container>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded-full border px-4 py-2 text-sm font-medium transition-colors',
                  filter === f
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-card text-muted-foreground hover:text-foreground',
                )}
              >
                {f}
              </button>
            ))}
          </div>

          {items.length === 0 ? (
            <p className="py-16 text-center text-muted-foreground">Nothing under {filter} just now.</p>
          ) : (
            <div className="space-y-4 pt-10">
              {lead && <LeadStory item={lead} />}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rest.map((n, i) => (
                  <Reveal key={n.slug} delay={i * 50}>
                    <StoryCard item={n} />
                  </Reveal>
                ))}
              </div>
            </div>
          )}
        </Container>
      </Section>

      <Section tone="muted" className="py-14">
        <Container>
          <SectionHeading eyebrow="Diary" title="Term dates" />
          <div className="grid gap-4 pt-8 sm:grid-cols-3">
            {TERM_DATES.map((t) => (
              <Panel key={t.term} className="flex items-start gap-3">
                <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div>
                  <p className="font-semibold">{t.term}</p>
                  <p className="pt-1 text-sm text-muted-foreground">
                    {t.opens} — {t.closes}
                  </p>
                </div>
              </Panel>
            ))}
          </div>
        </Container>
      </Section>
    </>
  );
}

/** The newest item gets the wide treatment; everything after it is a card. */
function LeadStory({ item }: { item: NewsItem }) {
  return (
    <Reveal>
      <LinkPanel to={`/news/${item.slug}`} className="p-6 sm:p-10">
        <div className="flex items-center gap-3">
          <Pill tone={item.category === 'Achievement' ? 'accent' : 'brand'}>{item.category}</Pill>
          <time className="text-xs text-muted-foreground" dateTime={item.date}>
            {formatDate(item.date)}
          </time>
        </div>
        <h2 className="max-w-3xl pt-4 font-display text-2xl font-bold leading-snug tracking-tight sm:text-3xl">
          {item.title}
        </h2>
        <p className="max-w-2xl pt-3 text-base leading-relaxed text-muted-foreground">{item.excerpt}</p>
        <span className="inline-flex items-center gap-1.5 pt-6 text-sm font-semibold text-primary">
          Read the notice <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </LinkPanel>
    </Reveal>
  );
}

function StoryCard({ item }: { item: NewsItem }) {
  return (
    <LinkPanel to={`/news/${item.slug}`} className="flex h-full flex-col">
      <div className="flex items-center gap-3">
        <Pill tone={item.category === 'Achievement' ? 'accent' : 'brand'}>{item.category}</Pill>
        <time className="text-xs text-muted-foreground" dateTime={item.date}>
          {formatDate(item.date)}
        </time>
      </div>
      <h3 className="pt-4 font-display text-lg font-bold leading-snug tracking-tight">{item.title}</h3>
      <p className="pt-2 text-sm leading-relaxed text-muted-foreground">{item.excerpt}</p>
      <span className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-primary">
        Read more <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </span>
    </LinkPanel>
  );
}
