---
'@moxxy/sdk': minor
'@moxxy/core': patch
'@moxxy/cli': minor
'@moxxy/plugin-cli': minor
---

Connect a provider without leaving the TUI: picking an unconnected provider
in `/model` now opens an inline connect dialog that installs the provider if
needed (pinned npm install), collects + validates an API key (stored in the
vault, never persisted plaintext), or drives the provider's OAuth sign-in —
then completes the exact model switch that was picked. Previously the picker
told you to quit and run `moxxy init` / `moxxy login` and restart.

New optional `SessionLike.providerSetup` (`ProviderSetupView`) seam; the init
wizard delegates to the same implementation so wizard and dialog semantics
cannot drift (a provider without `validateKey` now accepts the key instead of
pseudo-rejecting it). RemoteSession keeps the old guidance notice.
