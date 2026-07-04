# Module: _example

Reference module. Copy its shape when creating new modules (or run
`pnpm new-module <name>`).

## Layout

- `index.ts` — the **only** import surface other modules may use.
- `internal/` — implementation. Deep imports from other modules are blocked by lint.
- `__tests__/` — tests. May reach into `internal/`.

## May import

- (nothing — leaf module)

To change what this module may import, edit `allowedImports` for `_example` in
`module-map.json`. Never hand-edit `eslint.config.js` — the boundary rules are
generated from the map.
