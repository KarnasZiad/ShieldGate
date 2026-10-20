// @ts-check
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/dist/', '**/coverage/', '**/node_modules/']),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/console/**/*.{ts,vue}'],
    languageOptions: { globals: globals.browser },
  },
  pluginVue.configs['flat/recommended'],
  {
    // Single-file components: TypeScript syntax rules apply; types are checked by vue-tsc.
    files: ['**/*.vue'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        projectService: false,
      },
    },
    rules: {
      // Prettier owns formatting; eslint-config-prettier turns the conflicting Vue rules off.
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    files: ['apps/console/vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.spec.ts', '**/test/**/*.ts'],
    rules: {
      // Assertions such as expect(mock.method) reference methods without calling them.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    // mongosh scripts run by the MongoDB image on first start.
    files: ['infra/mongo/**/*.js'],
    languageOptions: { globals: { db: 'readonly' } },
  },
  prettier,
);
