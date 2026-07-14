#!/bin/bash
# usage-guard statusline: displays 5h/7d usage and caches the rate_limits
# payload per session so the Stop hook can read it (Stop hook stdin does
# not include rate_limits; only the statusline receives it).
set -u
input=$(cat)
dir="$HOME/.claude/usage-guard"
sid=$(jq -r '.session_id // empty' <<<"$input")

if [ -n "$sid" ]; then
  mkdir -p "$dir/cache"
  jq -c '{ts: (now|floor), cwd: (.cwd // .workspace.current_dir // null), rate_limits: (.rate_limits // null)}' \
    <<<"$input" > "$dir/cache/$sid.json" 2>/dev/null
fi

model=$(jq -r '.model.display_name // "Claude"' <<<"$input")
five=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input")
week=$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$input")
resets=$(jq -r '.rate_limits.five_hour.resets_at // empty' <<<"$input")

line="[$model]"
[ -n "$five" ] && line="$line 5h:$(printf '%.0f' "$five")%"
[ -n "$resets" ] && line="$line (resets $(date -d "@$resets" '+%H:%M'))"
[ -n "$week" ] && line="$line 7d:$(printf '%.0f' "$week")%"

if [ -n "$sid" ] && [ -f "$dir/enabled/$sid" ]; then
  line="$line | guard:ON($(cat "$dir/enabled/$sid")%)"
else
  line="$line | guard:off"
fi
echo "$line"
