// Lint for accessibility mistakes in JSX (design strategy §8): npm run lint
import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'e2e/.results/**', 'playwright-report/**'] },
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser },
    },
    plugins: { 'jsx-a11y': jsxA11y },
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // React components count as used; plain JS rules still catch real unused variables.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z]', args: 'none' }],
      'no-undef': 'error',
    },
  },
];
