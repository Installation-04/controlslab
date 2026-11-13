// SPDX-License-Identifier: AGPL-3.0-only
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-connector/**', 'apps/web/public/downloads/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs', '**/*.cjs'], languageOptions: { globals: { process: 'readonly', Buffer: 'readonly', URL: 'readonly', setTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', document: 'readonly', window: 'readonly' } } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
