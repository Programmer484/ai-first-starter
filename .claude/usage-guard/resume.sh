#!/bin/bash
# usage-guard resume: runs after the 5h window resets. Forks the paused
# conversation headlessly under a fresh session id that is pre-armed with the
# same threshold, so the guard chains if the resumed run hits the limit again.
# --fork-session is required: --session-id is rejected with plain --resume,
# and forking is also the only way to branch off a session that is still
# registered as a running background agent.
set -u
old_sid="${1:?session id required}"
threshold="${2:-90}"
cwd="${3:-$HOME}"
dir="$HOME/.claude/usage-guard"
log="$dir/logs/${old_sid}-resume.log"
mkdir -p "$dir/logs" "$dir/enabled"

new_sid=$(uuidgen)
echo "$threshold" > "$dir/enabled/$new_sid"

prompt="The 5-hour usage window has reset. Continue exactly where you left off and finish the task."

last_out=""
run_resume() {
  # claude can print an "Error:" banner yet still exit 0 (seen when the target
  # session is a live bg agent), so treat that banner as a failure too.
  local rc
  last_out=$(claude -p --resume "$old_sid" --fork-session --session-id "$new_sid" "$prompt" 2>&1)
  rc=$?
  printf '%s\n' "$last_out"
  echo "=== $(date -Is) attempt exited with code $rc ==="
  [ $rc -eq 0 ] && ! grep -q '^Error:' <<<"$last_out"
}

# Also leave a visible record in the directory the session was working in,
# so resumes are discoverable without digging through ~/.claude.
cwd_log_entry() {
  local status="$1"
  local f="$cwd/usage-guard-resumes.log"
  [ -d "$cwd" ] || return 0
  {
    echo "================================================================"
    echo "usage-guard resume — $(date '+%Y-%m-%d %H:%M:%S %Z') — $status"
    echo "paused session:  $old_sid"
    echo "resumed session: $new_sid"
    echo "view it:         cd '$cwd' && claude --resume $new_sid"
    echo "full log:        $log"
    echo "--- resumed run's final output ---"
    printf '%s\n' "$last_out"
    echo
  } >> "$f" 2>/dev/null
}

{
  echo "=== $(date -Is) usage-guard resuming $old_sid as $new_sid (threshold ${threshold}%) in $cwd ==="
  cd "$cwd" || cd "$HOME"
  if run_resume; then
    echo "=== $(date -Is) resume succeeded ==="
    cwd_log_entry "SUCCEEDED"
  else
    echo "=== retrying once ==="
    if run_resume; then
      echo "=== $(date -Is) resume succeeded on retry ==="
      cwd_log_entry "SUCCEEDED (on retry)"
    else
      rm -f "$dir/enabled/$new_sid"
      echo "=== $(date -Is) resume FAILED after retry; guard flag for $new_sid removed ==="
      cwd_log_entry "FAILED after retry"
    fi
  fi
} >> "$log" 2>&1
