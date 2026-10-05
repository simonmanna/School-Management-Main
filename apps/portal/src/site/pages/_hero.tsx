import type { ReactNode } from 'react';
import type { PhotoKey } from '@/site/content';
import { BrandBackdrop, Container, Photo, Pill } from '@/site/components';

/**
 * The banner every inner page opens with.
 *
 * Shared so the six pages cannot drift into six different heights and six
 * different eyebrow treatments — the fastest way to make a site built in one
 * afternoon look like it was built by three people in three.
 *
 * With `image`, the photo sits behind a brand-coloured scrim heavy enough that
 * the white type passes contrast on any photo the school later swaps in.
 */
export function PageHero({
  eyebrow,
  title,
  lede,
  image,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  lede?: ReactNode;
  image?: PhotoKey;
  children?: ReactNode;
}) {
  return (
    <section className="relative isolate overflow-hidden bg-[hsl(var(--brand-deep))] text-white">
      {image && (
        <>
          <Photo photo={image} alt="" priority sizes="100vw" className="absolute inset-0 -z-10 bg-transparent" />
          <div
            aria-hidden
            className="absolute inset-0 -z-10 bg-gradient-to-r from-[hsl(var(--brand-deep)/0.95)] via-[hsl(var(--brand-deep)/0.82)] to-[hsl(var(--brand-deep)/0.45)]"
          />
        </>
      )}
      <BrandBackdrop className="text-white" />
      <Container className={image ? 'relative py-20 sm:py-28' : 'relative py-16 sm:py-20'}>
        <div className="max-w-3xl">
          {eyebrow && <Pill tone="onDark">{eyebrow}</Pill>}
          <h1 className="pt-5 font-display text-3xl font-bold leading-[1.12] tracking-tight sm:text-4xl lg:text-5xl">
            {title}
          </h1>
          {lede && <p className="max-w-2xl pt-5 text-base leading-relaxed text-white/80 sm:text-lg">{lede}</p>}
          {children && <div className="pt-8">{children}</div>}
        </div>
      </Container>
    </section>
  );
}
