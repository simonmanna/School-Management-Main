import { Injectable } from '@nestjs/common';

/**
 * Renders `{{dotted.path}}` placeholders in a template body against an event
 * payload. Deliberately tiny — no handlebars dependency (none is installed) and
 * no logic/conditionals in templates, which keeps them safe to expose to admins.
 *
 * Rules:
 *   • `{{a.b.c}}` resolves a dotted path into the payload object.
 *   • A missing/undefined path renders as an empty string (never the literal
 *     `{{…}}`, never `undefined`), so a partial payload degrades quietly.
 *   • Values are coerced to string; objects are JSON-stringified.
 *   • Whitespace inside the braces is tolerated: `{{ a.b }}`.
 */
@Injectable()
export class TemplateRenderService {
  private static readonly PLACEHOLDER = /\{\{\s*([\w.$]+)\s*\}\}/g;

  render(body: string, payload: Record<string, unknown>): string {
    return body.replace(TemplateRenderService.PLACEHOLDER, (_m, path: string) => {
      const value = TemplateRenderService.resolvePath(payload, path);
      return TemplateRenderService.stringify(value);
    });
  }

  /** The distinct placeholder names in a body — powers the editor's variable list. */
  extractVariables(body: string): string[] {
    const out = new Set<string>();
    for (const m of body.matchAll(TemplateRenderService.PLACEHOLDER)) out.add(m[1]);
    return [...out];
  }

  static resolvePath(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc == null || typeof acc !== 'object') return undefined;
      return (acc as Record<string, unknown>)[key];
    }, obj);
  }

  private static stringify(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
}
