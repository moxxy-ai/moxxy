---
'@moxxy/cli': minor
'@moxxy/plugin-cli': minor
'@moxxy/plugin-plugins-admin': minor
---

`/plugins` now distinguishes **built-in** (bundled) from **installed** (on-demand from `~/.moxxy/plugins`) packages instead of showing everything as "on": the plugin host reports `installed` (manifest present = discovered) and the Packages tab badges core / installed / built-in. The Installable catalog is also populated with the six unbundled API-key providers (anthropic, openai, google, xai, zai, local) so they can be installed from the picker (and the init optional-plugins step).
