import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Renders teacher-authored rich text from the LMS.
 *
 * The API sanitises on write (`moodle/util/sanitize.ts`), so this is the second
 * line of defence: a legacy row, a direct database edit, or a future write path
 * that misses the chokepoint still cannot execute script in a pupil's browser.
 * Never call `dangerouslySetInnerHTML` directly anywhere in this app.
 *
 * Deliberately stricter than the admin app's equivalent. Lesson content reaches
 * children on their own phones, so an embed is allowed only from a host named
 * below — `ADD_TAGS: ['iframe']` without a source check would let any authored
 * page frame anything at all.
 */

/** Hosts whose players may be framed inside lesson content. */
const EMBED_HOSTS = new Set([
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'www.youtube.com',
  'youtube.com',
  'player.vimeo.com',
]);

let hookInstalled = false;

/**
 * Drop any iframe whose src is not an allowlisted https player. Installed once,
 * globally, because DOMPurify hooks are per-instance and re-adding the same
 * hook on every render would run it once per render per node.
 */
function installEmbedHook() {
  if (hookInstalled) return;
  DOMPurify.addHook('uponSanitizeElement', (node, data) => {
    if (data.tagName !== 'iframe') return;
    const el = node as unknown as Element;
    const src = el.getAttribute?.('src') ?? '';
    let ok = false;
    try {
      const url = new URL(src, window.location.origin);
      ok = url.protocol === 'https:' && EMBED_HOSTS.has(url.hostname);
    } catch {
      ok = false;
    }
    if (!ok) el.remove?.();
  });
  hookInstalled = true;
}

export function SafeHtml({ html, className }: { html?: string | null; className?: string }) {
  const clean = useMemo(() => {
    if (!html) return '';
    installEmbedHook();
    return DOMPurify.sanitize(html, {
      ADD_TAGS: ['iframe'],
      ADD_ATTR: ['allowfullscreen', 'allow', 'referrerpolicy', 'loading', 'target'],
    });
  }, [html]);

  if (!clean) return null;
  // `prose` is not available here (no typography plugin in this app), so the
  // readable defaults a lesson page needs are set directly.
  return (
    <div
      className={cn(
        'text-[15px] leading-relaxed [&_a]:text-primary [&_a]:underline',
        '[&_h1]:pt-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-bold',
        '[&_p]:py-1 [&_ul]:list-disc [&_ul]:py-1 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:py-1 [&_ol]:pl-5',
        '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-lg',
        '[&_iframe]:my-2 [&_iframe]:aspect-video [&_iframe]:w-full [&_iframe]:rounded-lg',
        '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic',
        '[&_table]:block [&_table]:overflow-x-auto',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
