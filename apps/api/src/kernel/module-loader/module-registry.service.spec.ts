import { ModuleRegistry } from './module-registry.service';

describe('ModuleRegistry', () => {
  it('accepts a valid dependency graph', () => {
    const registry = new ModuleRegistry();
    registry.register({ name: 'kernel', version: '1.0.0', dependencies: [] });
    registry.register({ name: 'core', version: '1.0.0', dependencies: ['kernel'] });
    expect(() => registry.onApplicationBootstrap()).not.toThrow();
  });

  it('throws on a missing dependency', () => {
    const registry = new ModuleRegistry();
    registry.register({ name: 'core', version: '1.0.0', dependencies: ['kernel'] });
    expect(() => registry.onApplicationBootstrap()).toThrow(/missing module 'kernel'/);
  });

  it('throws on a dependency cycle', () => {
    const registry = new ModuleRegistry();
    registry.register({ name: 'a', version: '1.0.0', dependencies: ['b'] });
    registry.register({ name: 'b', version: '1.0.0', dependencies: ['a'] });
    expect(() => registry.onApplicationBootstrap()).toThrow(/Cyclic/);
  });

  it('rejects duplicate module registration', () => {
    const registry = new ModuleRegistry();
    registry.register({ name: 'core', version: '1.0.0', dependencies: [] });
    expect(() => registry.register({ name: 'core', version: '2.0.0', dependencies: [] })).toThrow(
      /Duplicate/,
    );
  });

  describe('order kinds (Phase D)', () => {
    const build = () => {
      const registry = new ModuleRegistry();
      registry.register({ name: 'pos', version: '1.0.0', dependencies: [], orderKinds: [{ code: 'sale', label: 'Sale' }] });
      registry.register({ name: 'rental', version: '1.0.0', dependencies: [], orderKinds: [{ code: 'rental', label: 'Rental' }] });
      registry.register({ name: 'repair', version: '1.0.0', dependencies: [] }); // contributes none
      return registry;
    };

    it('aggregates order kinds across all modules', () => {
      expect([...build().knownOrderKinds()].sort()).toEqual(['rental', 'sale']);
    });

    it('accepts a module-declared kind and rejects an unknown one', () => {
      const registry = build();
      expect(registry.isKnownOrderKind('rental')).toBe(true);
      expect(registry.isKnownOrderKind('hotel')).toBe(false);
      expect(() => registry.assertKnownOrderKind('sale')).not.toThrow();
      expect(() => registry.assertKnownOrderKind('hotel')).toThrow(/Unknown order kind 'hotel'/);
    });
  });
});
