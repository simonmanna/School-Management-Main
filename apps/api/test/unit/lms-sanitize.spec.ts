import { RICH_TEXT_KEYS, sanitizeDto, sanitizeRichText } from '../../src/modules/school/lms/moodle/util/sanitize';

/**
 * L0.3 — stored-XSS regression suite. `mod_page` / `mod_label` bodies are rendered
 * with dangerouslySetInnerHTML, so anything that survives this cleaner runs in the
 * browser of every student in the course. Do not relax a case without a replacement.
 */
describe('LMS rich-text sanitisation', () => {
  describe('sanitizeRichText', () => {
    it('strips script tags and their contents', () => {
      const out = sanitizeRichText('<p>hi</p><script>alert(document.cookie)</script>');
      expect(out).toBe('<p>hi</p>');
      expect(out).not.toContain('alert');
    });

    it('strips inline event handlers', () => {
      expect(sanitizeRichText('<img src="https://x/y.png" onerror="alert(1)">')).not.toContain('onerror');
      expect(sanitizeRichText('<div onclick="steal()">x</div>')).not.toContain('onclick');
    });

    it('drops javascript: and data: URLs', () => {
      expect(sanitizeRichText('<a href="javascript:alert(1)">go</a>')).not.toContain('javascript:');
      // data: can carry an SVG with an inline script, so it is refused outright.
      expect(sanitizeRichText('<img src="data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==">')).not.toContain('data:');
    });

    it('keeps ordinary teacher formatting intact', () => {
      const html = '<h2>Week 1</h2><p><strong>Read</strong> chapter <em>3</em>.</p><ul><li>Q1</li></ul>';
      expect(sanitizeRichText(html)).toBe(html);
    });

    it('allows a YouTube embed but not an arbitrary iframe', () => {
      expect(sanitizeRichText('<iframe src="https://www.youtube.com/embed/abc"></iframe>')).toContain('youtube.com/embed/abc');
      expect(sanitizeRichText('<iframe src="https://evil.example/x"></iframe>')).toBe('');
    });

    it('forces rel and target on outbound links', () => {
      const out = sanitizeRichText('<a href="https://example.org">x</a>');
      expect(out).toContain('rel="noopener noreferrer nofollow"');
      expect(out).toContain('target="_blank"');
    });

    it('rejects style values outside the allowlist', () => {
      const out = sanitizeRichText('<p style="text-align:center;position:fixed;top:0">x</p>');
      expect(out).toContain('text-align:center');
      expect(out).not.toContain('position');
    });

    it('returns an empty string for null/undefined rather than throwing', () => {
      expect(sanitizeRichText(null)).toBe('');
      expect(sanitizeRichText(undefined)).toBe('');
    });
  });

  describe('sanitizeDto', () => {
    it('cleans rich-text keys and leaves everything else byte-identical', () => {
      const dto = {
        name: 'Quiz <b>1</b>',                       // plain text — React escapes it
        intro: '<p>ok</p><script>alert(1)</script>',
        maxScore: 100,
        openAt: '2026-09-01T00:00:00Z',
        shuffleAnswers: true,
      };
      const out = sanitizeDto(dto);
      expect(out.intro).toBe('<p>ok</p>');
      expect(out.name).toBe('Quiz <b>1</b>');
      expect(out.maxScore).toBe(100);
      expect(out.openAt).toBe('2026-09-01T00:00:00Z');
      expect(out.shuffleAnswers).toBe(true);
    });

    it('reaches rich text nested inside arrays of objects', () => {
      const dto = { overallFeedback: [{ grade: 50, text: '<b>ok</b><script>x()</script>' }] };
      const out = sanitizeDto(dto);
      expect(out.overallFeedback[0].text).toBe('<b>ok</b>');
      expect(out.overallFeedback[0].grade).toBe(50);
    });

    it('cleans every string under a rich-text key, however deep', () => {
      const dto = { content: { sections: [{ nested: '<img src=x onerror=alert(1)>' }] } };
      const out = sanitizeDto(dto) as any;
      expect(out.content.sections[0].nested).not.toContain('onerror');
    });

    it('does not mutate the caller\'s object', () => {
      const dto = { intro: '<script>x</script>' };
      sanitizeDto(dto);
      expect(dto.intro).toBe('<script>x</script>');
    });

    it('preserves Date instances', () => {
      const d = new Date('2026-01-01');
      const out = sanitizeDto({ dueAt: d }) as any;
      expect(out.dueAt).toBeInstanceOf(Date);
      expect(out.dueAt.getTime()).toBe(d.getTime());
    });

    it('leaves ANY class instance intact, not just Date', () => {
      // Regression: walk() used to rebuild every object from Object.entries, so a
      // Prisma Decimal came back as `{ constructor, s, e, d }` and Prisma then
      // refused to serialise it — which broke course restore and rollover.
      class Decimalish {
        constructor(public s = 1, public e = 1, public d = [20]) {}
        toString() { return '20'; }
      }
      const dec = new Decimalish();
      const out = sanitizeDto({ maxScore: dec, intro: '<script>x</script>' }) as any;
      expect(out.maxScore).toBeInstanceOf(Decimalish);
      expect(out.maxScore).toBe(dec);
      // Rich text alongside it is still cleaned.
      expect(out.intro).toBe('');
    });

    it('does not walk into a class instance even under a rich-text key', () => {
      class Body { constructor(public html = '<b>x</b>') {} }
      const b = new Body();
      const out = sanitizeDto({ content: b }) as any;
      expect(out.content).toBe(b);
    });

    it('covers the fields the plugins actually write', () => {
      for (const k of ['intro', 'content', 'body', 'summary', 'definition', 'feedback', 'text']) {
        expect(RICH_TEXT_KEYS.has(k)).toBe(true);
      }
    });
  });
});
