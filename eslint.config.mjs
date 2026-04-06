import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/web/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      'docs/docs-site/**',
      'docs/screenshots/**',
      '.github/ISSUE_TEMPLATE/**',
      '.github/PULL_REQUEST_TEMPLATE.md',
      'src/mcp-local/**',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.recommended,
  {
    files: [
      'src/**/*.{ts,tsx}',
      'scripts/**/*.{ts,tsx}',
      'tests/**/*.{ts,tsx}',
      'cli/src/**/*.{ts,tsx}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['web/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
