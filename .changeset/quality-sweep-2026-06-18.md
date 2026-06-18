---
"@moxxy/sdk": minor
"@moxxy/cli": patch
"@moxxy/desktop": patch
---

Repo-wide quality + performance sweep (audit-driven, all gates green)

A monorepo audit (report in `.claude/audits/quality-sweep-2026-06-18.md`) drove
three test-backed waves. Behavior is unchanged except for the bug fixes below.

**SDK (new public helpers):** `assertNever`, `writeFileAtomicSync`,
`compareSemver`/`parseSemverCore`, and `countNodes` are now exported from
`@moxxy/sdk` as the single home for those patterns.

**Dead code & consistency:** removed the orphaned CDP screencast plumbing in
`plugin-browser` and ~16 other proven-unused exports/modules; replaced the only
banned private-field-poke cast with a DI seam; deduped repeated helpers onto
shared homes (SearchBox, diff helpers, token estimate, semver, countNodes).

**Security / correctness fixes:** view-spec `isSafeViewUrl` whitespace XSS
bypass (parser + renderer walls); capability-broker SSRF-via-redirect,
symlink/TOCTOU, and unbounded-buffer hardening; permission deny-rules now fail
closed on an invalid regex; OAuth refresh race + stale-token-field fixes;
isolator SIGKILL escalation, cwd, and abort-signal wiring; bounded validation on
remote-reachable IPC commands; refusal to overwrite a built-in provider; an
unbounded `completedTurns` leak; and several resource/timer/listener leaks.

**Generics & atomicity:** extracted `ActiveDefRegistry`/`DefMapRegistry` bases
(8 copy-paste registries → thin subclasses) and `defineOpenAICompatProvider`
(per-vendor copy-paste collapsed); closed invariant-#5 gaps by adding
per-instance mutexes + atomic writes to the file-backed stores that lacked them.

Larger/riskier items (the O(n²) chat-model fold rewrite, a generic JSON store,
god-file splits, and the long-tail findings) are tracked in `TECH_DEBT.md` for
focused follow-up PRs rather than bundled here.
