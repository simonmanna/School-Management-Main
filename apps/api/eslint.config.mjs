// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';

/**
 * Flat config for the API. There was no ESLint config anywhere in the repo
 * until now, so `pnpm lint` could never succeed and CI never ran it — this is
 * deliberately a low bar that passes on the existing tree. Tighten it by
 * promoting rules from `warn` to `error` as the codebase is cleaned up.
 *
 * `@eslint/js` is not resolvable under pnpm's strict node_modules, so the base
 * JS recommended set is not spread in; the typescript-eslint flat/recommended
 * config below covers what matters for a TS-only codebase.
 */
export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'prisma/migrations/**',
      'prisma/migrations_archive/**',
      'prisma/migrations-archive/**',
      'backup/**',
      'coverage/**',
      '**/*.d.ts',
    ],
  },
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // NestJS DI and Prisma's generated types make `any` hard to avoid at the
      // seams. Warn so new occurrences are visible without failing the build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // Decorator-heavy Nest classes trip this constantly.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      // These are real defect classes — keep them hard errors.
      'no-debugger': 'error',
      'no-fallthrough': 'error',
      'no-unsafe-finally': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    // Tests are looser: fixtures and mocks legitimately use `any`.
    files: ['test/**/*.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
];
