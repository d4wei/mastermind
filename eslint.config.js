import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'desktop/target/', 'desktop/reviewer-ui/', 'desktop/gen/', 'tools/perf/.build/', 'themes/fonts/', '.claude/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [tseslint.configs.recommendedTypeChecked, reactHooks.configs.flat.recommended],
    languageOptions: {
      parserOptions: {
        // Both programs by name: a project service would not find tsconfig.node.json for tests.
        project: ['./tsconfig.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true,
      }],
      // Interfaces declare closure-backed members, store actions and props alike, with method syntax.
      '@typescript-eslint/unbound-method': 'off',
      // Components deliberately mirror the latest props and render-time caches into refs during render.
      'react-hooks/refs': 'off',
      // A compiler performance advisory; the flagged effects deliberately sync state to props or events.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['tests/**'],
    rules: {
      // Test doubles implement promise-returning host interfaces with async functions that never await.
      '@typescript-eslint/require-await': 'off',
      // Test doubles mimic the Tauri bridge, which rejects with plain serialized values.
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      // Harnesses hoist a rendered component's setters into the test's scope.
      'react-hooks/globals': 'off',
      // Mocks, fixtures and child-process output are handled untyped.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    // The document core is imported by the desktop interface and by Node tooling alike.
    files: ['document/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { regex: '^node:', message: 'document/ stays isomorphic: no Node APIs.' },
          { regex: '^react(-dom)?(/|$)', message: 'document/ stays isomorphic: no React.' },
          { regex: '(^|/)(ui|tools|tests)(/|$)', message: 'document/ imports no interface or tooling code.' },
        ],
        paths: ['fs', 'path', 'os', 'url', 'crypto', 'child_process', 'process', 'buffer']
          .map((name) => ({ name, message: 'document/ stays isomorphic: no Node APIs.' })),
      }],
      'no-restricted-globals': ['error', ...['window', 'document', 'navigator', 'location', 'localStorage',
        'sessionStorage', 'process', 'Buffer', 'require', '__dirname', '__filename']
        .map((name) => ({ name, message: 'document/ stays isomorphic: no DOM or Node globals.' }))],
    },
  },
)
