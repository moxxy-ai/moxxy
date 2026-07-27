---
'@moxxy/cli': patch
---

Add the three documents a security review asks for.

Everything the enterprise work added was invisible to a buyer: `docs/` had no deployment guide, no threat model, and no statement of what leaves the machine.

`docs/threat-model.md` names the adversaries considered and, deliberately, the ones that are not, then states what each control is actually worth. It has a section for the places where a name promises more than the mechanism delivers: the audit trail is tamper-evident and not tamper-proof, the vault protects against leakage and not local access, in-process isolation is best-effort by construction, and `inputMatches` patterns are unanchored.

`docs/data-flow.md` lists every outbound request by host and trigger. There is no telemetry, and the single unattended request is the TUI's version check against `registry.npmjs.org`, which is named rather than glossed over.

`docs/deployment.md` goes from `moxxy profile enterprise` to a verified workstation, including the step that confirms a locked key actually resists a user override, because a misspelled lock looks exactly like a working one.

Also corrects `SECURITY.md`, which still described a passphrase fallback the vault no longer demands.
