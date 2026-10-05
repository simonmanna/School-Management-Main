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

/**
 * Hosts whose players may be framed. Mirrors `ALLOWED_IFRAME_HOSTS` in the API's
 * sanitiser — the point of the second line of defence is that it holds when the
 * first did not, and `ADD_TAGS: ['iframe']` with no source check would let a row
 * that reached the database by some other path frame anything at all.
 */
const EMBED_HOSTS = new Set([
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'youtube.com',
  'youtu.be',
  'player.vimeo.com',
  'vimeo.com',
]);

let hookInstalled = false;

/** Installed once: DOMPurify hooks are per-instance and would otherwise stack. */
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
      ADD_ATTR: ['allowfullscreen', 'allow', 'sandbox', 'referrerpolicy', 'target', 'loading'],
    });
  }, [html]);
  if (!clean) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />;
}
