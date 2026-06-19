---
"@moxxy/cli": patch
"@moxxy/sdk": patch
"@moxxy/desktop": patch
---

Repo-wide worst-case hardening (audit-driven). A pessimistic re-audit of every
package/app scored security, performance, code-quality, extensibility (+a11y on
UI surfaces) and cataloged 757 findings; this resolves the high+medium+clear-low
set with regression tests for the failure paths. Highlights:

- **Security:** email-detector ReDoS made linear (bounded local-part + label
  count + windowed scan); IPv4-mapped-IPv6 SSRF bypass closed; `memory_*` and
  workflow `runId` path-traversal sanitized; cross-host redirects no longer
  replay `Authorization`/body; webhook filter-regex ReDoS bounded; capability
  isolation now also covers tools registered after `onInit`; recursive subagent
  fan-out capped.
- **Robustness (no happy-path assumptions):** unbounded child/stdout/socket/grep
  buffers bounded (OOM); missing `'error'` listeners + per-call timeouts + abort
  wiring added across the WS transport, runner JSON-RPC, isolators, browser
  sidecar, MCP boot, and provider streams; stale-name/out-of-order resolves,
  malformed-JSON tool input, and corrupt on-disk caches now degrade instead of
  crashing.
- **Accessibility:** real focus traps + focus restoration + ARIA/`aria-modal` +
  keyboard navigation + Escape across desktop modals/sheets, the shared
  `desktop-ui` Modal, the workflow canvas, and the TUI.
- **Quality:** dead code removed (incl. the committed `apps/docs/.astro` cache),
  per-workflow schedule-sync isolation, scheduler invalid-timezone resilience,
  and worst-case regression tests throughout.
