// Flat ESLint config.
//
// The module-boundary rules are GENERATED from module-map.json — do not
// hand-edit them here. Change architecture in module-map.json and the
// boundaries update on the next lint run.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import { readModuleMap } from './scripts/module-map.ts';

// useEnv: MODULE_MAP lets tests lint against a doctored map without mutating
// the real file (the same opt-in seam module-sync uses).
const moduleMap = readModuleMap(undefined, true);

// module A may import module B  <=>  B is in A.allowedImports.
// (A module may always import itself; boundaries skips same-element imports.)
const elementTypesRules = moduleMap.modules.map((m) => ({
  from: [['module', { name: m.name }]],
  allow: m.allowedImports.map((dep) => ['module', { name: dep }]),
}));

// External-package policy, generated from `allowedExternals` in module-map.json.
// Semantics: a module WITHOUT `allowedExternals` is unrestricted — the map's
// `default: 'allow'` covers it and no rule below is emitted. A module WITH the
// field may import ONLY those npm packages (subpaths like `pkg/sub` count as
// allowed); [] = pure module (no external packages at all). `node:` builtins and
// relative/internal imports are always allowed. Cross-module imports are LOCAL
// (not external) so they stay governed by `boundaries/element-types` above.
//
// Per restricted module we emit rules in order (last match wins):
//   1. disallow every external/core package (carries the actionable message),
//   2. re-allow `node:` builtins,
//   3. re-allow each declared package and its subpaths.
const externalRules = moduleMap.modules.flatMap((m) => {
  if (!Array.isArray(m.allowedExternals)) return [];
  const from = [['module', { name: m.name }]];
  const rules = [
    {
      from,
      disallow: ['*', '@*/*', '@*/*/**', '*/**'],
      message:
        `Module '${m.name}' may not import external package '\${dependency.source}'. ` +
        `Add '\${dependency.source}' to allowedExternals for '${m.name}' in module-map.json ` +
        `(or remove the import).`,
    },
    { from, allow: ['node:*', 'node:*/*', 'node:*/**'] },
  ];
  if (m.allowedExternals.length > 0) {
    rules.push({
      from,
      allow: m.allowedExternals.flatMap((pkg) => [pkg, `${pkg}/*`, `${pkg}/**`]),
    });
  }
  return rules;
});

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
      // A module with `allowedExternals` in module-map.json may import ONLY the
      // listed npm packages. Generated from the map — never hand-edit.
      'boundaries/external': [
        'error',
        {
          default: 'allow',
          rules: externalRules,
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
    files: ['scripts/**/*.ts', '*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
