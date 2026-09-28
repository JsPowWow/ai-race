// Проверка кода: npm run lint
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['node_modules/', 'dist/', 'app/generated/', 'tools/shot*.mjs', '.claude/', '.impeccable/'] }, // .claude — сторонние скиллы
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['tools/**/*.mjs', 'test/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  // Новый код на TypeScript (#15): те же правила, плюс рекомендованные для TS
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ['**/*.ts', '**/*.tsx'] })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-unused-vars': 'off', // вместо него — версия, которая понимает типы
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Типы импортируются отдельно (import type): при сборке по файлу их просто стирают
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
];
