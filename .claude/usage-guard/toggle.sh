#!/bin/bash
# usage-guard toggle: arms/disarms the guard for the CURRENT session only.
# Must run via the Bash tool inside a Claude Code session (needs
# CLAUDE_CODE_SESSION_ID, which Claude Code exports to tool commands).
set -u
dir="$HOME/.claude/usage-guard"
sid="${CLAUDE_CODE_SESSION_ID:-}"
if [ -z "$sid" ]; then
  echo "usage-guard: error: CLAUDE_CODE_SESSION_ID is not set. Run this via Claude Code's Bash tool."
  exit 1
fi
mkdir -p "$dir/enabled" "$dir/cache" "$dir/logs"
unit="usage-guard-resume-${sid:0:8}"

case "${1:-status}" in
  on)
    t="${2:-90}"
    if ! [[ "$t" =~ ^[0-9]+$ ]] || [ "$t" -lt 1 ] || [ "$t" -gt 100 ]; then
      echo "usage-guard: threshold must be an integer 1-100 (got: $t)"; exit 1
    fi
    echo "$t" > "$dir/enabled/$sid"
    echo "usage-guard: ON for session ${sid:0:8}… — will pause at ${t}% of the 5h window and auto-resume after reset."
    ;;
  off)
    rm -f "$dir/enabled/$sid"
    systemctl --user stop "$unit.timer" "$unit.service" 2>/dev/null
    echo "usage-guard: OFF for session ${sid:0:8}… (any scheduled resume cancelled)."
    ;;
  status)
    if [ -f "$dir/enabled/$sid" ]; then
      echo "usage-guard: ON (threshold $(cat "$dir/enabled/$sid")%) for session ${sid:0:8}…"
    else
      echo "usage-guard: OFF for session ${sid:0:8}…"
    fi
    c="$dir/cache/$sid.json"
    if [ -f "$c" ]; then
      jq -r '"last seen usage — 5h: \(.rate_limits.five_hour.used_percentage // "n/a")% (resets_at \(.rate_limits.five_hour.resets_at // "n/a")), 7d: \(.rate_limits.seven_day.used_percentage // "n/a")%"' "$c"
    else
      echo "no cached usage data yet (appears after the first API response; Pro/Max only)"
    fi
    if systemctl --user list-units --all --plain --no-legend "$unit.timer" 2>/dev/null | grep -q "$unit.timer"; then
      echo "a resume timer is scheduled: $unit.timer ($(systemctl --user show "$unit.timer" -p NextElapseUSecRealtime --value 2>/dev/null))"
    fi
    ;;
  *)
    echo "usage: usage-guard [on [threshold] | off | status]"
    ;;
esac
