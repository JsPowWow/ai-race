// Проверка кода: npm run lint
import js from '@eslint/js';
import globals from 'globals';

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
];
