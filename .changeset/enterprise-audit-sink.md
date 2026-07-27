---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

Add an audit trail: a tamper-evident record of what was done and for whom.

`audit log` previously appeared in this codebase only in comments. What existed was the event log: the conversation, complete and local, with no retention, no export, no tamper evidence, and full of payloads nobody wants forwarded to a SIEM.

`AuditSink` is a new swappable block, registered like every other, with a protected hash-chained local floor writing owner-only JSONL under `~/.moxxy/audit/`. Each record commits to its predecessor's hash, so removing or editing one breaks every hash after it. `moxxy security audit-log` verifies the chains and exits 1 on a break, so a scheduled compliance check can gate on it. Chaining is tamper-EVIDENT, not tamper-proof: it catches silent selective deletion, which is the realistic threat.

Records are bounded and redacted at the projection boundary, so a single line is safe to forward. Prompt text is recorded only when `audit.includePromptText` is set; the SHA-256 always is, so a given prompt stays provable without the trail disclosing it. Tool inputs are redacted alongside a hash of the original.

Off unless `audit.enabled` is set. A discovered plugin's sink is registered but never auto-activated: a sink's whole purpose is to send recorded actions elsewhere, so silent adoption would be an exfiltration path.

Also new in `@moxxy/sdk`: `redactSecrets` / `redactSecretText`, which mask by value SHAPE as well as by field name, so a bearer token inside a Bash `command` is caught.
