---
name: debug-session-logs
description: Inspect and repair session event logs and desktop chat NDJSON (resume bugs, lost context, duplicated history) — use when a conversation resumes wrong or a mirror desyncs.
---

# Debug session logs

Two independent stores persist every desktop conversation (known debt,
TECH_DEBT P1 #2):

1. **Runner session log** — `~/.moxxy/sessions/<id>.jsonl`. Authoritative
   append-only event log; replayed IN FULL from seq 0 on every attach.
2. **Desktop chat NDJSON** — `~/.moxxy/chats/<workspaceId>.jsonl`
   (`desktop-host/src/chat-log.ts`). The renderer's windowed mirror;
   append is idempotent by event id (PR #107) with a byte-offset page index
   (A40).

What the runtime already self-heals (don't re-fix):
- **Corrupt middle line** in a session log: `restoreEvents` skips it,
  re-sequences in-memory events to contiguous seq 0..n-1, warns with counts,
  and atomically REWRITES the repaired JSONL (A25). A truncated replay at a
  gap means you're on a pre-A25 build.
- **Write failures**: persistence latches a `degraded` flag + one structured
  warn per failure streak (A24) — check stderr JSON.
- **`/new` / session.reset**: aborts in-flight turns, clears the runner log,
  broadcasts `session.reset` so every mirror clears in lockstep, truncates the
  JSONL (protocol v3, A10). Old context resurrecting on `--resume` = reset
  didn't reach the runner (renderer cleared first — the remaining desync
  window, P1 #2).

Inspect:
```sh
ls -lat ~/.moxxy/sessions/ | head            # newest session ids
tail -3 ~/.moxxy/sessions/<id>.jsonl | jq .  # events: {seq, id, type, ...}
jq -r .type ~/.moxxy/sessions/<id>.jsonl | sort | uniq -c   # shape of the log
```

Rules when fixing: the log is APPEND-ONLY (compaction/elision are events with
`replacedRange`, selectors are pure folds); duplicated desktop history =
id-dedup cache regression, not a reason to dedupe at render time.
