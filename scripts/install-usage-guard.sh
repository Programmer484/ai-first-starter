#!/bin/bash
# Install usage-guard into the user's global Claude Code config (~/.claude), so
# it guards every project on this machine — not just this repo.
#
#   bash scripts/install-usage-guard.sh
#
# usage-guard auto-pauses a session when the 5h usage window crosses a threshold
# and forks it back to life headlessly once the window resets. Arm it per-session
# with /usage-guard on [threshold]; see .claude/usage-guard/README.md.
#
# Copies .claude/usage-guard/*.sh and .claude/commands/usage-guard.md into
# ~/.claude, then merges the statusLine + Stop hook into ~/.claude/settings.json
# (backed up first). Re-running is safe: the Stop hook entry is de-duped.
#
# Requires jq, uuidgen, systemd --user (Linux only), and the `claude` CLI.
set -euo pipefail

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
src="$repo/.claude/usage-guard"
dir="$HOME/.claude/usage-guard"
cmds="$HOME/.claude/commands"
settings="$HOME/.claude/settings.json"

for bin in jq uuidgen systemd-run; do
  command -v "$bin" >/dev/null || { echo "usage-guard: missing required command: $bin"; exit 1; }
done

mkdir -p "$dir/enabled" "$dir/cache" "$dir/logs" "$cmds"

for f in statusline toggle stop-hook resume; do
  install -m 755 "$src/$f.sh" "$dir/$f.sh"
done
install -m 644 "$repo/.claude/commands/usage-guard.md" "$cmds/usage-guard.md"

[ -f "$settings" ] || echo '{}' > "$settings"
cp "$settings" "$settings.bak.$(date +%s)"

# The Stop hook reads rate_limits from the cache the statusline writes — that
# payload only ever reaches the statusline's stdin — so a pre-existing statusline
# must be merged by hand rather than clobbered.
existing=$(jq -r '.statusLine.command // empty' "$settings")
if [ -n "$existing" ] && [ "$existing" != "$dir/statusline.sh" ]; then
  echo "usage-guard: WARNING — you already have a statusLine command:"
  echo "    $existing"
  echo "  Left untouched. usage-guard's Stop hook needs the rate_limits cache, so add"
  echo "  these two lines to your own statusline script:"
  echo '    sid=$(jq -r ".session_id // empty" <<<"$input")'
  echo '    jq -c "{ts:(now|floor),cwd:(.cwd//.workspace.current_dir//null),rate_limits:(.rate_limits//null)}" <<<"$input" > "$HOME/.claude/usage-guard/cache/$sid.json"'
  set_statusline=false
else
  set_statusline=true
fi

jq --arg d "$dir" --argjson set_sl "$set_statusline" '
  (if $set_sl then .statusLine = {type: "command", command: ($d + "/statusline.sh")} else . end)
  | .hooks //= {}
  | .hooks.Stop //= []
  | .hooks.Stop |= (
      map(select([(.hooks // [])[].command] | index($d + "/stop-hook.sh") | not))
      + [{hooks: [{
           type: "command",
           command: ($d + "/stop-hook.sh"),
           statusMessage: "usage-guard: checking 5h window",
           timeout: 15
         }]}]
    )
' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"

echo "usage-guard: installed."
echo "  scripts:  $dir"
echo "  command:  $cmds/usage-guard.md"
echo "  settings: $settings (backup written alongside it)"
echo
echo "Restart Claude Code, then run:  /usage-guard on 90"
