# Game-specific notes (carry over to the Life Game repo — do not keep in the template)

Everything below is the game instantiation of features that landed generically
in the template. Apply after duping the repo.

## 1. `allowedExternals` assignments for the section-7 module map

The template now enforces per-module external-package allowlists
(`allowedExternals` in `module-map.json`, scaffolded via
`pnpm new-module <name> --externals a,b` or `--pure`). For the Life Game
modules:

| Module          | allowedExternals               | Why                                                              |
| --------------- | ------------------------------ | ---------------------------------------------------------------- |
| `core-app`      | `["pixi.js"]`                  | Pixi Application bootstrap, ticker                               |
| `core-viewport` | `["pixi.js", "pixi-viewport"]` | The ONLY module importing pixi-viewport                          |
| `world`         | `[]` (`--pure`)                | Pure data + logic — the cheap-TDD rule                           |
| `entities`      | `[]` (`--pure`)                | Typed data + factories, no Pixi                                  |
| `systems`       | `[]` (`--pure`)                | Pure functions over world+entities                               |
| `render`        | `["pixi.js"]`                  | Maps entity state → sprites                                      |
| `ui`            | `[]` (`--pure`)                | DOM overlay for v1 — no packages needed                          |
| `save`          | `[]` (`--pure`)                | Persistence logic pure; storage adapter may need a package later |
| `assets`        | `["pixi.js"]`                  | Loader wrapper around Pixi assets                                |

This makes ADR section 7's hard rule ("world/entities/systems/save never
import pixi.js") a lint failure with a named fix instead of a convention.

## 2. Scaffold commands (run in the game repo)

```bash
pnpm new-module core-app      --desc "Pixi Application bootstrap, ticker, resize, scenes" --externals pixi.js
pnpm new-module core-viewport --desc "pixi-viewport wrapper: pan/zoom/world coords" --externals pixi.js,pixi-viewport
pnpm new-module world         --desc "land/tiles/zones — pure data + logic" --pure
pnpm new-module entities      --desc "flowers, trees, house — typed data + factories" --pure
pnpm new-module systems       --desc "growth, XP, economy, day-night — pure functions" --pure --imports world,entities
pnpm new-module render        --desc "entity state → sprites" --externals pixi.js --imports entities,world,core-viewport --gates polish
pnpm new-module ui            --desc "HUD, menus — DOM overlay" --pure --gates polish
pnpm new-module save          --desc "versioned save schema + migrations" --pure --imports world,entities
pnpm new-module assets        --desc "manifest + loader wrapper" --externals pixi.js
```

(Adjust `--imports` edges as the design firms up; `--gates polish` on
`render`/`ui` per the ADR's polish-lane rule — logic modules stay `full`.)

## 3. PixiJS 8 scaffolding notes (for the agent that instantiates the game)

- Pixi 8 init is async: `const app = new Application(); await app.init({...})`
  — NOT the v7 constructor pattern.
- `pixi-viewport` 6.x is the Pixi-8-compatible line.
- UI: DOM overlay preferred over Pixi text for v1 (cheaper, accessible).
- Render smoke test (Playwright screenshot) comes later; not part of the
  verify gate in v1.

## 4. Property-test targets (TESTING.md §5 applied to the game)

The fast-check doctrine lands hardest on `systems/`:

- Growth: plant age/stage monotonically non-decreasing under tick; never skips
  a stage; blooming only within its season window.
- Economy: coins never negative; buy+sell round-trip never mints money.
- Day-night: time-of-day wraps mod 24h; season transitions are total (every
  day maps to exactly one season).
- Save: `load(save(state))` deep-equals `state` for arbitrary generated worlds
  (the single highest-value property in the game — catches schema drift).
