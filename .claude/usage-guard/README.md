# usage-guard

Auto-pauses a Claude Code session when the 5-hour usage window crosses a
threshold, then forks the conversation back to life headlessly once the window
resets. Opt-in per session — an unarmed session pays nothing but one `[ -f ]`
check per turn.

## Install

```bash
bash scripts/install-usage-guard.sh
```

This installs into the **global** `~/.claude` (not this repo's `.claude/`), so
the guard covers every project on the machine. It copies the four scripts here
plus `.claude/commands/usage-guard.md`, and merges a `statusLine` and a `Stop`
hook into `~/.claude/settings.json` (backed up first; re-running is safe).

Requires `jq`, `uuidgen`, systemd `--user`, and the `claude` CLI. Linux only —
the resume timer is a systemd user unit.

## Use

```
/usage-guard on 90     # arm this session: pause at 90% of the 5h window
/usage-guard status    # threshold, last-seen usage, any scheduled resume
/usage-guard off       # disarm, cancelling a scheduled resume
```

When a turn ends at or above the threshold, the Stop hook schedules a
`systemd-run --user` timer for ~2 minutes after `resets_at`, tells you the
session is pausing, and stops. The timer forks the conversation under a fresh
session id that is pre-armed with the same threshold, so a long run chains
across several windows. Each resume is logged to `~/.claude/usage-guard/logs/`
and to `usage-guard-resumes.log` in the directory the session was working in.

## How the pieces fit

| File            | Role                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `statusline.sh` | Renders 5h/7d usage **and** caches the `rate_limits` payload per session       |
| `toggle.sh`     | Arms/disarms the current session (`enabled/<session-id>` holds the threshold)  |
| `stop-hook.sh`  | Stop hook: over threshold → schedule the resume timer, pause the session       |
| `resume.sh`     | Runs after reset: `claude -p --resume <old> --fork-session --session-id <new>` |

The statusline is load-bearing, not cosmetic: `rate_limits` is delivered only on
the statusline's stdin, so its per-session cache is the Stop hook's only source
of usage data. Drop the statusline and the guard silently never fires.

`--fork-session` is required in `resume.sh` — `--session-id` is rejected
alongside a plain `--resume`, and forking is the only way to branch off a
session still registered as a running background agent.
