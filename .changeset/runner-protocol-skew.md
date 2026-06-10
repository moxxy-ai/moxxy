---
'@moxxy/runner': minor
'@moxxy/desktop-host': patch
'@moxxy/desktop-ipc-contract': patch
'@moxxy/desktop': patch
---

fix(runner): tolerate additive protocol skew + stop the desktop hot-update reconnect loop

A desktop Tier-1 hot-update ships only the JS bundle, so it advances the bundled
`@moxxy/runner` client past the separately-bundled CLI's runner. The strict
`protocolVersion !==` handshake then rejected the (purely additive) skew and the
supervisor respawned the SAME pinned CLI forever — an infinite "Reconnecting…".

- **Tolerant negotiation (contract change):** new `MIN_COMPATIBLE_PROTOCOL_VERSION`
  (bumped only on a BREAKING protocol change). The server accepts any client
  `>= MIN_COMPATIBLE` and returns its own version; the client records the server
  version and gates the v4-only `workflow.validateDraft/save/getRun` builder methods
  on it, degrading with a clear "update the CLI" error instead of a raw
  method-not-found. Additive skew now attaches cleanly.
- **Desktop lockstep:** the signed app-bundle manifest carries a `runnerProtocol`
  stamp; the bootstrap refuses to activate (reverts to floor) any JS bundle whose
  stamp exceeds the spawnable CLI's protocol.
- **No infinite loop:** a persistent mismatch surfaces a terminal
  `protocol-incompatible` connection phase with an actionable message after one
  failed recovery, rather than retrying into the same dead end.
