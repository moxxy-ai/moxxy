---
'@moxxy/sdk': minor
'@moxxy/core': minor
'@moxxy/cli': minor
'@moxxy/plugin-provider-admin': minor
'@moxxy/desktop-ipc-contract': minor
'@moxxy/desktop-host': minor
'@moxxy/client-core': minor
'@moxxy/desktop': minor
---

Desktop: live registry refresh + interactive provider management.

The runner now broadcasts `info.changed` after every completed turn, so registry changes made by tools inside a conversation (provider_add, mcp_add, workflow_create, skill writes, …) reach attached clients; the desktop forwards the push to the renderer (`session.info.changed` → `SESSION_INFO_REFRESH_EVENT`) and the Settings panel re-fetches live — no more app restart to see an agent-added provider.

Settings → Providers is now interactive: enable/disable any provider (runner protocol v7 `provider.setEnabled`, persisted to `preferences.json#disabledProviders` and honored by boot's activation walk; disabling the ACTIVE provider is refused), and a Configure sheet sets the API key (vault + live readiness re-probe via `provider.refreshReady`) and, for runtime-registered providers, the stored baseURL/default model (`provider.configure` through the new `SessionLike.providerAdmin` view). OAuth providers get a `moxxy login` hint instead of a key form.
