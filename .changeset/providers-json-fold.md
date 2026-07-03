---
'@moxxy/config': minor
'@moxxy/plugin-provider-admin': minor
'@moxxy/desktop-host': minor
'@moxxy/cli': patch
'@moxxy/runner': patch
'@moxxy/desktop-ipc-contract': patch
---

The LAST config store outside the unified tree is gone: runtime-registered
(OpenAI-compatible) vendors now persist at `plugins.provider.items.<name>`
in `~/.moxxy/config.yaml` (`config` carries the vendor payload, `model` the
default) instead of `~/.moxxy/providers.json`. The provider-admin API is
unchanged — the tools, the runner's `provider.configure`, and the desktop
settings sheet all moved with it; the desktop reads the tree directly (yaml
parse, no @moxxy/config in the Electron main). `provider_remove` refuses to
touch a built-in provider's item (picker-written model/enabled prefs
survive). Clean-slate per repo convention: re-add custom vendors via
`provider_add` or the desktop sheet — no migration shim.
