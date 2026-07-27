---
'@moxxy/cli': minor
'@moxxy/config': minor
'@moxxy/sdk': minor
'@moxxy/plugin-plugins-admin': patch
---

Add signed policy bundles and `moxxy policy`.

Permission rules could already be pushed from the system config, which works on one machine. Across a fleet every rule change became a file change on every host, and a host that missed one looked exactly like a host that got it. A bundle is a signed document published once and subscribed to by `policy.bundles`, carrying a revision that lands in the audit trail, so `moxxy receipt` proves which revision any past run executed under.

A bundle carries permission rules and nothing else. Not `registryUrl`, not a key, not a proxy, not `security.enabled`, and one carrying any of them is rejected rather than quietly stripped. It arrives over the network, so the worst case for whoever controls that host stays "they can deny things and break the fleet" instead of "they can loosen us".

Loading fails closed: a configured bundle that cannot be verified stops the session rather than running without the rules the machine is supposed to enforce. The last verified copy is cached and carries a session through an outage, re-verified against the pinned key on every read. A bad signature is never treated as unavailable, or anyone answering for the URL could pin a fleet to an old revision by serving garbage.

`moxxy policy` shows the rules in force with each rule's origin; `--check` exits 1 when a host is serving off a stale cache. The Ed25519 verifier moved to `@moxxy/sdk` as `verifyEd25519`, since policy has to bind on a machine with no plugins installed and a control you can disable by uninstalling something is not a control.
