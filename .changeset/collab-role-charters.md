---
"@moxxy/plugin-collab": minor
"@moxxy/mode-collaborative": minor
---

feat(collaborative): coordinator-authored role charters (proper, task-suited roles)

Every peer ran the SAME generic prompt and only a role LABEL was injected — so a
"designer" and a "developer" behaved identically. Now the ARCHITECT authors, per
roster agent, a tailored CHARTER (persona + responsibilities + quality bar +
collaboration + definition-of-done) suited to THIS task, and each peer runs with
that charter as part of its system prompt — proper roles created for the task,
not pre-configured.

- RosterEntry gains an optional `charter`; the architect prompt asks for a 4-8
  sentence charter per agent.
- The charter is written to the run dir (NOT the workspace/worktree, so it's
  never committed), passed to the peer by PATH via a new `MOXXY_COLLAB_CHARTER_FILE`
  env (never the body), and read at boot into the STATIC system-prompt prefix
  (cached once, not re-billed per turn).
- Safety: the charter is LLM-authored, so it is sanitised (NUL-stripped, capped
  at 2000 chars) and APPENDED after the authoritative shared rules (never the
  sole prompt); the roster-approval dialog shows a clipped charter preview — the
  human gate on injected system-prompt text.

Tests: charter carried + capped + written outside the committed tree + passed to
the peer; peerPromptWithCharter appends-not-replaces; architect prompt asks for a
charter.
