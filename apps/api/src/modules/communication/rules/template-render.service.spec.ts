import { TemplateRenderService } from './template-render.service';

describe('TemplateRenderService', () => {
  const svc = new TemplateRenderService();

  it('substitutes dotted placeholders', () => {
    expect(svc.render('Stock low: {{product.name}} ({{quantity}})', { product: { name: 'Arabica' }, quantity: 3 })).toBe(
      'Stock low: Arabica (3)',
    );
  });

  it('tolerates whitespace in braces', () => {
    expect(svc.render('Hi {{ name }}', { name: 'Mary' })).toBe('Hi Mary');
  });

  it('missing path renders empty, never the literal braces or "undefined"', () => {
    expect(svc.render('X={{missing}}Y', {})).toBe('X=Y');
  });

  it('coerces numbers and booleans', () => {
    expect(svc.render('{{n}}/{{b}}', { n: 42, b: true })).toBe('42/true');
  });

  it('extractVariables lists distinct placeholders', () => {
    expect(svc.extractVariables('{{a}} {{b.c}} {{a}}').sort()).toEqual(['a', 'b.c']);
  });
});
