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
});
