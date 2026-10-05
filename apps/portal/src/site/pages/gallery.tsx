import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { GALLERY, type GalleryCategory } from '@/site/content';
import { Container, Photo, Reveal, Section } from '@/site/components';
import { usePageTitle } from '@/site/site-shell';
import { PageHero } from '@/site/pages/_hero';
import { cn } from '@/lib/utils';

const FILTERS: Array<'All' | GalleryCategory> = ['All', 'Classroom', 'Campus', 'Sport & arts', 'Celebrations'];

/**
 * The photo gallery.
 *
 * A masonry of CSS columns rather than a grid, so portrait and landscape photos
 * keep their own shape instead of being cropped to one box. Clicking opens a
 * lightbox that is a real modal: focus moves into it, Escape and the arrow keys
 * work, and focus returns to the photo that opened it.
 */
export default function GalleryPage() {
  usePageTitle('Gallery');
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');
  const [open, setOpen] = useState<number | null>(null);
  const items = filter === 'All' ? GALLERY : GALLERY.filter((g) => g.category === filter);

  return (
    <>
      <PageHero
        eyebrow="Gallery"
        title="Life at school"
        lede="Lessons, games afternoons, graduations and ordinary mornings — a look at the campus and the pupils who fill it."
        image="friends"
      />

      <Section>
        <Container>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter photos">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
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

          <div className="columns-1 gap-4 pt-10 sm:columns-2 lg:columns-3">
            {items.map((g, i) => (
              <Reveal key={g.photo} delay={(i % 6) * 40} className="mb-4 break-inside-avoid">
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  className="group relative block w-full overflow-hidden rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <Photo
                    photo={g.photo}
                    alt={g.caption}
                    imgClassName="h-auto transition-transform duration-500 group-hover:scale-105"
                    sizes="(min-width: 1024px) 380px, (min-width: 640px) 50vw, 100vw"
                  />
                  <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-10 text-sm font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    {g.caption}
                    <span className="block text-xs font-normal text-white/70">{g.category}</span>
                  </span>
                </button>
              </Reveal>
            ))}
          </div>
        </Container>
      </Section>

      {open !== null && items[open] && (
        <Lightbox
          items={items}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}

function Lightbox({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: typeof GALLERY;
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const item = items[index];
  const prev = useCallback(() => onIndex((index - 1 + items.length) % items.length), [index, items.length, onIndex]);
  const next = useCallback(() => onIndex((index + 1) % items.length), [index, items.length, onIndex]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, prev, next]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.caption}
      className="fixed inset-0 z-50 flex flex-col bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-4 py-3 text-white sm:px-6">
        <p className="text-sm tabular-nums text-white/70">
          {index + 1} / {items.length}
        </p>
        <button
          ref={closeRef}
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="rounded-full p-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <X className="h-6 w-6" />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 sm:px-16" onClick={(e) => e.stopPropagation()}>
        <Photo
          key={item.photo}
          photo={item.photo}
          alt={item.caption}
          sizes="100vw"
          priority
          className="max-h-full bg-transparent"
          imgClassName="max-h-[calc(100dvh-9rem)] w-auto object-contain"
        />
        <button
          type="button"
          aria-label="Previous photo"
          onClick={prev}
          className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-4"
        >
          <ChevronLeft className="h-7 w-7" />
        </button>
        <button
          type="button"
          aria-label="Next photo"
          onClick={next}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-4"
        >
          <ChevronRight className="h-7 w-7" />
        </button>
      </div>

      <p className="px-4 py-4 text-center text-sm text-white/85">
        {item.caption} <span className="text-white/50">· {item.category}</span>
      </p>
    </div>
  );
}
