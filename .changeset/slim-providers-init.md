---
'@moxxy/cli': minor
---

Slim the bundle + rework init around on-demand providers. The six API-key providers (anthropic, openai, google, xai, zai, local) are no longer bundled into the CLI — they install on demand from npm into `~/.moxxy/plugins` and are discovered by the plugin host, keeping the kernel slim (no eager provider onInit / tool bloat at boot). The two OAuth/subscription providers (openai-codex, claude-code) stay bundled as the out-of-box "sign in" default (and the CLI's credential resolver links their token helpers).

`init` is reworked: it offers the full provider catalog (loaded + installable), and an `ensureProvider` step installs + enables a not-yet-bundled provider before collecting its key/OAuth. A new optional wizard step lets you install extra plugins. The shared `provision()` engine + `moxxy provision` (flags or `--spec -`) drive the same install→vault→config flow headlessly.

Also: the six private provider packages are flipped publishable + added to a fixed changeset group (co-version with cli/sdk/core), and a latent bug is fixed — plugin discovery now honors `MOXXY_HOME` (matching where installs land), so an installed provider is reliably discovered + activated.
