## What & why

<!-- One or two sentences. Link the task/spec. -->

## Modules touched

<!-- List modules changed. If dependencies changed, note the module-map.json edit. -->

## Checklist

- [ ] `pnpm verify` is green (format, lint, boundaries, typecheck, tests, coverage, knip)
- [ ] Imports go through module `index.ts` only (no deep imports)
- [ ] New module deps declared in `module-map.json` `allowedImports`
- [ ] Tests added for new/changed public exports (see `TESTING.md`)
- [ ] No dead code, no lowered thresholds
