---
'@moxxy/sdk': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/cli': minor
'@moxxy/plugin-cli': patch
'@moxxy/plugin-channel-http': minor
---

Plugin-declared init hooks: plugins can now ship a declarative setup step at
`package.json#moxxy.setup` (title, required flag, typed fields:
secret/string/boolean/select). `moxxy init` walks every installed plugin's
step — secrets go to the VAULT with a `${vault:NAME}` ref written to the
plugin's `options.<key>` (resolved at boot, never plaintext), other kinds
persist through the shared schema-validated writer; skipping a
`required: true` setup leaves the package DISABLED until configured; re-runs
prefill ("enter to keep"). Installing such a plugin (tool or /plugins picker)
surfaces `needsSetup` so the user is pointed at the configuration
immediately. Proof: the HTTP channel declares its bearer token as a required
secret field.
