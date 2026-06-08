---
"@moxxy/cli": patch
---

Harden `moxxy plugins install`/`remove` against argument injection: the imperative
install/uninstall path now rejects a flag-like spec (a leading `-`, e.g. `-g` or
`--registry=…`) before handing it to `npm`, while still accepting the legitimate
`name@version`, git (`github:`/`git+`/`https://`), and local-path specs. Internal
cleanup: the duplicated `NPM_NAME_RE` / `diffSnapshot` / `PluginSnapshot` are hoisted
into one shared module in `@moxxy/plugin-plugins-admin`.
