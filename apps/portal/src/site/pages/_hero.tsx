import type { ReactNode } from 'react';
import { BrandBackdrop, Container, Pill } from '@/site/components';

/**
 * The banner every inner page opens with.
 *
 * Shared so the six pages cannot drift into six different heights and six
 * different eyebrow treatments — the fastest way to make a site built in one
 * afternoon look like it was built by three people in three.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-[hsl(var(--brand-deep))] text-white">
      <BrandBackdrop className="text-white" />
      <Container className="relative py-16 sm:py-20">
        <div className="max-w-3xl">
          {eyebrow && <Pill tone="onDark">{eyebrow}</Pill>}
          <h1 className="pt-5 font-display text-3xl font-bold leading-[1.12] tracking-tight sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {lede && <p className="max-w-2xl pt-5 text-base leading-relaxed text-white/75 sm:text-lg">{lede}</p>}
          {children && <div className="pt-8">{children}</div>}
        </div>
      </Container>
    </section>
  );
}
