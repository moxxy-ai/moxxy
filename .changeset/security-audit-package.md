---
"@moxxy/cli": minor
"@moxxy/sdk": minor
"@moxxy/core": patch
"@moxxy/plugin-security": minor
"@moxxy/plugin-plugins-admin": minor
---

Package-level capability aggregation: `moxxy security audit --package <name>` shows one package's tools plus their COMBINED capability surface (widest-wins union via the new `aggregateCapabilitySpecs` in the SDK), `--by-package` prints a declared/total rollup per plugin, and `install_plugin` now reports the just-installed package's capability surface (declared/total + undeclared tool names) next to the registration diff. Tool→plugin attribution comes from the plugin host's loaded records (`PluginHost.ownerOfTool`), which also makes the previously-dormant `security.perPlugin` isolator overrides actually route.
