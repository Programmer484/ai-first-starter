// Flat ESLint config.
//
// The module-boundary rules are GENERATED from module-map.json — do not
// hand-edit them here. Change architecture in module-map.json and the
// boundaries update on the next lint run.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';

const moduleMap = JSON.parse(readFileSync(join(import.meta.dirname, 'module-map.json'), 'utf8'));

// module A may import module B  <=>  B is in A.allowedImports.
// (A module may always import itself; boundaries skips same-element imports.)
const elementTypesRules = moduleMap.modules.map((m) => ({
  from: [['module', { name: m.name }]],
  allow: m.allowedImports.map((dep) => ['module', { name: dep }]),
}));

export default tseslint.config(
  {
    ignores: ['dist', 'coverage', 'node_modules', '.claude/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'scripts/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['src/**/*'],
      'boundaries/elements': [
        {
          type: 'module',
          pattern: 'src/modules/*',
          mode: 'folder',
          capture: ['name'],
        },
      ],
    },
    rules: {
      // A module may only import modules listed in its allowedImports.
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          message:
            "Module '${file.name}' may not import module '${dependency.name}'. Add it to allowedImports in module-map.json if this is intended.",
          rules: elementTypesRules,
        },
      ],
      // Only a module's index.ts is importable from other modules.
      // This makes deep imports (e.g. modules/a/internal/x from module b) fail.
      'boundaries/entry-point': [
        'error',
        {
          default: 'disallow',
          message:
            "Deep import blocked: import module '${dependency.name}' through its index.ts, not '${dependency.source}'.",
          rules: [{ target: [['module', {}]], allow: 'index.ts' }],
        },
      ],
    },
  },
  {
    // Tests may reach into their own module's internals freely.
    files: ['src/**/__tests__/**/*.ts', 'src/**/*.{test,spec}.ts'],
    rules: {
      'boundaries/entry-point': 'off',
    },
  },
  {
    files: ['scripts/**/*.ts', '*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
