---
description: Route a natural-language preference to the right durable home — PREFERENCES.md for agent behavior, a PR for framework changes, or just do it for session-only whims.
argument-hint: <preference or behavior change in plain language>
---

<!--
Acceptance criterion (for maintainers):
  /customize always include the preview link in your final message
    → agent states the routing decision ("This is an agent-behavior
      preference — adding it to PREFERENCES.md"), then adds ONE deduped
      bullet under the right section.
  /customize block commits after 6pm
    → agent states this needs a hook/config change, proposes the diff,
      and ships it through the normal PR flow.
  /customize for this session, keep answers short
    → agent just does it; no file is touched.
The routing decision is ALWAYS stated to the user before any write.
-->

You are handling a **customization request**: **$ARGUMENTS**

The person driving may be non-technical. Your job is to route their request
to the one place where it will durably stick, tell them which route you
picked and why, and then act. Never write a file before stating the route.

## Routing (pick exactly one)

1. **Agent-behavior preference** — a standing instruction agents can honor
   by reading it (tone, output format, what to include in messages, review
   habits). → Edit `PREFERENCES.md`:
   - Read the file first. If an existing bullet already covers the request,
     say so and refine that bullet instead of adding a duplicate; if a
     bullet contradicts it, ask which should win.
   - Add one concise bullet under `## Always`, `## Never`, or a
     `## When <situation>` section (create the section if needed). Keep the
     user's own words where they are clear.
   - No verify run is needed for a PREFERENCES.md-only edit; the file is
     prose, not code.

2. **Framework-behavior change** — anything that must be _enforced_, not
   just remembered: a new check, hook, script, config value, or gate. A
   preference bullet cannot enforce anything (see CLAUDE.md's
   deterministic-check ethos). → Propose the concrete diff to the user
   first; on approval, implement it through the repo's normal flow (scope,
   edit, `pnpm verify`, ship with `pnpm pr`). If the request could be either
   a reminder or an enforcement, ask one question to decide.

3. **Session-only whim** — "for now", "just this once", or anything scoped
   to the current conversation. → Just do it. No file churn.

## Output contract

- First line: the route, in plain language — e.g. "This is an
  agent-behavior preference; I'll record it in PREFERENCES.md under
  `## Always`."
- Then the action (the edit, the proposed diff, or the adjusted behavior).
- Close by confirming where the preference now lives and how to change it
  later (`/customize` again, or edit `PREFERENCES.md` by hand).
