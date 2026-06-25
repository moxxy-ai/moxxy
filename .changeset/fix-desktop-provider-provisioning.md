---
"@moxxy/desktop": patch
---

fix(desktop): provision API-key providers on demand during onboarding

The slim-kernel redesign stopped bundling API-key providers (anthropic, openai,
…) into the CLI — they install on demand from npm. But the desktop's onboarding
had no install step: picking the default `anthropic` (or any API-key provider)
saved the key, then `setActive` threw "Provider not registered" and the
onboarding / provider-recovery gate looped forever. Only the two bundled OAuth
providers (claude-code, openai-codex) yielded a working desktop.

Onboarding now runs the CLI's headless provisioner — a new
`onboarding.provisionProvider` IPC that shells out to `moxxy provision <slug>`
(the key was already stored via `saveProviderKey`) to install + enable the
package and write `plugins.provider.default`, then restarts the runner so it
discovers the freshly-installed package and its boot activation makes the
provider active. OAuth providers keep their bundled `setProvider` path.
