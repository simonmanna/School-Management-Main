// @ts-check
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * Flat config for the web SPA. Same posture as the API config: warn-heavy so it
 * passes on the existing tree, with the rules that catch real defects kept as
 * errors. `react-hooks/rules-of-hooks` is the one that matters most here — a
 * conditional hook call is a runtime crash, and this app has no error
 * boundaries yet, so a crash white-screens the whole terminal.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'dev-dist/**', 'coverage/**', '**/*.d.ts'],
  },
  ...tsPlugin.configs['flat/recommended'],
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-debugger': 'error',
      'no-fallthrough': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
];
