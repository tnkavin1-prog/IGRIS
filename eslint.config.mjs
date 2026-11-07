import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'release/**',
      'dist/**',
      '**/dist/**',
      'docs/api/**',
      'test-results/**',
      'playwright-report/**',
      'coverage/**',
      '**/*.d.ts',
      'package-lock.json',
      '.chrome-debug-profile/**',
      '.chrome-debug-data/**',
      'notes/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.worker,
        chrome: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-restricted-globals': [
        'error',
        { name: 'event', message: 'Use the handler argument instead of the global event.' },
      ],
    },
  },
  {
    files: ['apps/chrome-extension/src/sidepanel/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['apps/local-bridge/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: [
      'scripts/**/*.mjs',
      'apps/desktop-hud/scripts/**/*.mjs',
      'tests/**/*.mjs',
      'playwright.config.mjs',
      'playwright.soak.config.mjs',
      'vitest.config.ts',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['apps/desktop-hud/src/main/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['apps/desktop-hud/src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': 'off',
    },
  },
  {
    files: ['tests/unit/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-empty': 'off',
    },
  },
);
