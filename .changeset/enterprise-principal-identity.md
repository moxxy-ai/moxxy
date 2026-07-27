---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

Attribute the event log to a `Principal`, so a transcript records who acted.

Until now events carried `source` (a category: user, model, tool, …) but no subject, which meant a transcript proved a machine did something rather than that a person did. Audit, role-based policy, and cost attribution all need the subject, and retrofitting it later is far more expensive than adding it now.

`EventBase.actor` is a new optional field stamped on every appended event, and `AppContext.actor` exposes the same identity to lifecycle hooks so a policy or audit hook can answer "who is asking". The CLI attributes sessions to the local OS account (`os` issuer, worth exactly as much as local account separation); a channel that authenticates its users overrides it with `session.setPrincipal`.

Runner protocol v11: `attach` carries an optional `principal`, so a thin client's work is attributed on the runner's authoritative log. Additive, so older clients keep working and their events stay unattributed. `moxxy doctor` reports the identity in force.

The field is optional on purpose: the event log is append-only and persisted, so sessions recorded before this replay unattributed and must keep doing so. Treat absent as unattributed, never as an error.
