import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { NEWS } from '@/site/content';
import {
  Container, CtaLink, LinkPanel, Pill, Section, SectionHeading, formatDate,
} from '@/site/components';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';

/**
 * One news item.
 *
 * An unknown slug renders a real "not found" here rather than redirecting to the
 * news index. A parent who followed a link from an SMS to a notice that has been
 * removed should be told that, not silently dropped on a list and left to guess
 * which item they were meant to be reading.
 */
export default function NewsItemPage() {
  const { slug } = useParams<{ slug: string }>();
  const item = NEWS.find((n) => n.slug === slug);

  usePageTitle(item ? item.title : 'Notice not found');

  if (!item) {
    return (
      <Section>
        <Container className="max-w-xl py-10 text-center">
          <SectionHeading
            align="center"
            title="That notice is no longer here"
            lede="It may have been taken down after the event it announced. Everything current is on the news page."
          />
          <div className="pt-8">
            <CtaLink to="/news">
              All news <ArrowRight className="h-4 w-4" />
            </CtaLink>
          </div>
        </Container>
      </Section>
    );
  }

  const index = NEWS.findIndex((n) => n.slug === item.slug);
  const others = NEWS.filter((_, i) => i !== index).slice(0, 3);

  return (
    <>
      <PageHero
        eyebrow={item.category}
        title={item.title}
        lede={
          <span className="inline-flex items-center gap-2">
            <time dateTime={item.date}>{formatDate(item.date)}</time>
          </span>
        }
      />

      <Section className="py-14">
        <Container>
          <Link
            to="/news"
            className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> All news
          </Link>

          <article className="max-w-2xl pt-8">
            <p className="text-lg font-medium leading-relaxed">{item.excerpt}</p>
            <div className="space-y-5 pt-6 text-base leading-relaxed text-muted-foreground">
              {item.body.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
          </article>

          <div className="max-w-2xl pt-10">
            <div className="rounded-2xl border bg-muted/40 px-6 py-5 text-sm">
              <p className="font-semibold">Guardians</p>
              <p className="pt-1 text-muted-foreground">
                Term notices, results and fee statements for your own child are on the portal.{' '}
                <Link to="/login" className="font-medium text-primary underline-offset-4 hover:underline">
                  Sign in
                </Link>
                .
              </p>
            </div>
          </div>
        </Container>
      </Section>

      {others.length > 0 && (
        <Section tone="muted" className="py-14">
          <Container>
            <SectionHeading title="More from the school" />
            <div className="grid gap-4 pt-8 sm:grid-cols-3">
              {others.map((n) => (
                <LinkPanel key={n.slug} to={`/news/${n.slug}`} className="flex h-full flex-col">
                  <div className="flex items-center gap-3">
                    <Pill tone={n.category === 'Achievement' ? 'accent' : 'brand'}>{n.category}</Pill>
                    <time className="text-xs text-muted-foreground" dateTime={n.date}>
                      {formatDate(n.date)}
                    </time>
                  </div>
                  <h3 className="pt-3 font-semibold leading-snug">{n.title}</h3>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-4 text-sm font-semibold text-primary">
                    Read <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </LinkPanel>
              ))}
            </div>
          </Container>
        </Section>
      )}
    </>
  );
}
