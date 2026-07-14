#!/bin/bash
# usage-guard Stop hook: if this session is armed and the 5h window is at or
# above the threshold, schedule a headless resume (systemd user timer) for
# just after the window resets and tell the user the session is pausing.
# No-op (fast, silent) for sessions that haven't been armed via /usage-guard.
set -u
input=$(cat)
dir="$HOME/.claude/usage-guard"

sid=$(jq -r '.session_id // empty' <<<"$input")
[ -n "$sid" ] || exit 0
flag="$dir/enabled/$sid"
[ -f "$flag" ] || exit 0

threshold=$(cat "$flag" 2>/dev/null)
[[ "$threshold" =~ ^[0-9]+$ ]] || threshold=90

# rate_limits is documented only on the statusline stdin. Check our own
# stdin anyway (cheap, future-proof), then fall back to the statusline cache.
used=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input")
resets=$(jq -r '.rate_limits.five_hour.resets_at // empty' <<<"$input")
cache="$dir/cache/$sid.json"
if [ -z "$used" ] && [ -f "$cache" ]; then
  used=$(jq -r '.rate_limits.five_hour.used_percentage // empty' "$cache")
  resets=$(jq -r '.rate_limits.five_hour.resets_at // empty' "$cache")
fi
[ -n "$used" ] || exit 0   # no data yet (first turn, or not a Pro/Max sub)

usedint=${used%%.*}
[[ "$usedint" =~ ^[0-9]+$ ]] || exit 0
[ "$usedint" -ge "$threshold" ] || exit 0

now=$(date +%s)
buffer=120
if [[ "$resets" =~ ^[0-9]+$ ]] && [ "$resets" -gt "$now" ]; then
  delay=$((resets - now + buffer))
else
  delay=$buffer
fi

cwd=$(jq -r '.cwd // empty' <<<"$input")
{ [ -n "$cwd" ] && [ -d "$cwd" ]; } || cwd="$HOME"

unit="usage-guard-resume-${sid:0:8}"
if ! systemctl --user list-units --all --plain --no-legend "$unit.timer" 2>/dev/null | grep -q "$unit.timer"; then
  systemd-run --user --on-active="${delay}s" --timer-property=AccuracySec=15s \
    --unit="$unit" --property=WorkingDirectory="$cwd" \
    "$dir/resume.sh" "$sid" "$threshold" "$cwd" >/dev/null 2>&1
fi

resume_time=$(date -d "@$((now + delay))" '+%H:%M:%S %Z')
printf '{"systemMessage":"usage-guard: 5h window at %s%% (threshold %s%%). Pausing this session; headless resume scheduled for %s (systemd unit %s). Cancel: /usage-guard off"}\n' \
  "$usedint" "$threshold" "$resume_time" "$unit"
exit 0
