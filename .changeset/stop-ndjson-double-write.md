---
"@moxxy/desktop": minor
---

feat(desktop): stop the NDJSON double-write for v10 runners; raise FLOOR to v10

With the runner now authoritative for every chat (it owns the log and legacy
chats are migrated into it on open), the desktop's NDJSON chat mirror is no
longer load-bearing — so we stop writing it where the runner is authoritative
and require a v10 runner.

- `chat.append` is runtime-gated on the ATTACHED runner's protocol version (not
  the baked FLOOR, so it stays correct when a JS hot-update outruns the bundled
  CLI): a v10+ runner owns the authoritative log, so the NDJSON mirror is
  skipped; a `<v10` runner (or an unknown version) still writes it so the
  renderer's NDJSON fallback never loses an event.
- `FLOOR_RUNNER_PROTOCOL` raised 9 → 10 (== `RUNNER_PROTOCOL_VERSION`): the
  dual-history transition is complete, so the desktop drops `<v10` runner support
  and v10 JS hot-updates can apply on fresh installs. The release/floor guard
  (`FLOOR <= RUNNER`) is unchanged.

The NDJSON store is left on disk as a frozen read fallback; physically retiring
it is the final separate follow-up.
