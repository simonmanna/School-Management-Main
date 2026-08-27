import sanitizeHtml from 'sanitize-html';

/**
 * Rich-text sanitisation for teacher-authored activity content (ADR-014 §8).
 *
 * Sanitising happens on WRITE, not on read: `mod_page`, `mod_label`, `mod_lesson`
 * and friends store HTML that the course page renders with `dangerouslySetInnerHTML`,
 * so a single unsanitised write is a stored XSS against every student enrolled in the
 * course. Cleaning at the write chokepoint means the stored row is already inert and
 * every future reader — the web app, a PDF export, a mobile client — is safe without
 * having to remember.
 */

/** Video hosts a teacher may embed. Deliberately short; widen only on request. */
const ALLOWED_IFRAME_HOSTS = [
  'www.youtube.com',
  'www.youtube-nocookie.com',
  'youtube.com',
  'youtu.be',
  'player.vimeo.com',
  'vimeo.com',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'small',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img', 'figure', 'figcaption', 'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    iframe: ['src', 'width', 'height', 'title', 'allowfullscreen', 'sandbox', 'referrerpolicy'],
    td: ['colspan', 'rowspan', 'style'],
    th: ['colspan', 'rowspan', 'scope', 'style'],
    col: ['span', 'style'],
    '*': ['class', 'style', 'dir', 'lang'],
  },
  // `data:` is deliberately absent. A data: URI can carry an SVG with an inline
  // <script>, which is a stored-XSS vector that survives tag filtering. Images
  // belong in the LMS file area and are referenced by URL.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowedIframeHostnames: ALLOWED_IFRAME_HOSTS,
  allowIframeRelativeUrls: false,
  allowedStyles: {
    '*': {
      'text-align': [/^left$|^right$|^center$|^justify$/],
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i],
      width: [/^\d+(\.\d+)?(px|em|rem|%)$/],
      height: [/^\d+(\.\d+)?(px|em|rem|%)$/],
    },
  },
  transformTags: {
    // An untrusted outbound link must not get a handle on the opener window,
    // and must not pass our referrer along.
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer nofollow', target: '_blank' }, true),
    // Embeds run in the tightest sandbox that still lets a video play.
    iframe: sanitizeHtml.simpleTransform(
      'iframe',
      { sandbox: 'allow-scripts allow-same-origin allow-presentation', referrerpolicy: 'no-referrer' },
      true,
    ),
  },
  // Drop the *content* of a script/style block too, not just its tags — otherwise
  // `<script>alert(1)</script>` degrades to the visible text `alert(1)`.
  nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  // An iframe pointed at a non-allowlisted host loses its src above and would
  // otherwise survive as an empty frame. Remove the element itself.
  exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
};

/** Clean one HTML string. Returns '' for null/undefined so callers can assign directly. */
export function sanitizeRichText(html: unknown): string {
  if (html == null) return '';
  return sanitizeHtml(String(html), OPTIONS);
}

/**
 * DTO keys whose values are rendered as HTML somewhere. Matched at ANY depth, so
 * nested shapes (`overallFeedback: [{ text }]`, `pages: [{ body }]`) are covered
 * without each plugin having to opt in.
 */
export const RICH_TEXT_KEYS = new Set([
  'intro',
  'content',
  'body',
  'summary',
  'description',
  'definition',
  'feedback',
  'text',
  'instructAuthors',
  'instructReviewers',
]);

/**
 * Deep-clean every rich-text field in a plugin DTO, leaving all other values
 * untouched. Applied by the course-module service at the two points where a DTO
 * reaches a plugin, so no plugin can forget to call it.
 */
export function sanitizeDto<T>(dto: T): T {
  return walk(dto, false) as T;
}

/**
 * Only PLAIN objects are traversed.
 *
 * Rebuilding a class instance from `Object.entries` destroys it: a Prisma
 * `Decimal` came back as `{ constructor, s, e, d }`, which Prisma then refused
 * to serialise. Dates, Decimals, Buffers and every other class instance are
 * values here, not containers to walk into.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, inRichKey: boolean): unknown {
  if (typeof value === 'string') return inRichKey ? sanitizeRichText(value) : value;
  if (Array.isArray(value)) return value.map((v) => walk(v, inRichKey));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = walk(v, inRichKey || RICH_TEXT_KEYS.has(k));
    }
    return out;
  }
  return value;
}
