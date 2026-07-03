---
'@moxxy/sdk': minor
'@moxxy/plugin-plugins-admin': minor
'@moxxy/cli': patch
'@moxxy/plugin-cli': patch
---

Install-on-first-use: asking for a capability whose package isn't installed
now offers to install it at the point of use instead of failing. `/goal` and
`/collab` without their mode installed open an install-confirm picker and,
after the install lands, re-run the original command; the `/mode` picker
lists catalog-provided modes badged "installs on first use"; `set_default`
naming an uninstalled contribution throws a typed `PLUGIN_NOT_INSTALLED`
error carrying the providing package (so the model tool gets an actionable
hint too). Catalog entries gain a `provides` mapping (category + contribution
name) that powers the lookup.
