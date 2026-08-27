import DOMPurify from 'dompurify';
import { useMemo } from 'react';

/**
 * Renders server-stored rich text. Content is already sanitised on write by the
 * API (`moodle/util/sanitize.ts`); this is the second line of defence, so that a
 * gap in a write path — a legacy row, a direct DB edit, a future endpoint that
 * forgets the chokepoint — still cannot execute script in a student's browser.
 *
 * Use this anywhere HTML from the server is rendered. Never call
 * dangerouslySetInnerHTML directly.
 */
export function SafeHtml({ html, className }: { html?: string | null; className?: string }) {
  const clean = useMemo(
    () =>
      DOMPurify.sanitize(html ?? '', {
        ADD_TAGS: ['iframe'],
        ADD_ATTR: ['allowfullscreen', 'sandbox', 'referrerpolicy', 'target', 'loading'],
      }),
    [html],
  );
  if (!clean) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
