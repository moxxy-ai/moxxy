---
"@moxxy/cli": minor
"@moxxy/sdk": minor
"@moxxy/desktop": minor
---

Connect locally-installed `claude` and `codex` CLIs as providers, fix the desktop provider-config feedback, and stop claude-code defaulting to a gated model.

- **Borrow credentials from an installed CLI.** `claude-code` and `openai-codex` now resolve credentials in the order vault (`moxxy login`) → env var → the installed CLI's own store — codex `~/.codex/auth.json` (honors `CODEX_HOME`), claude macOS Keychain (`Claude Code-credentials`) / `~/.claude/.credentials.json` (override via `MOXXY_CLAUDE_CREDENTIALS_FILE`). If you're already signed into `claude`/`codex`, the provider just works with no separate `moxxy login`. This is "borrow live": the installed CLI stays the owner that refreshes the token; moxxy only refreshes + writes the rotated bundle back when the CLI's own token has gone stale, so the two never invalidate each other's (rotating, single-use) refresh token.
- **"Connected via installed CLI" badge.** A new optional `ProviderInfo.credentialSource` (`vault` | `env` | `installed-cli` | …) flows through the runner to desktop Settings → Providers, so an auto-borrowed provider reads "Active · connected via installed CLI" instead of looking unconfigured. Purely additive — no runner protocol bump.
- **Desktop: provider config now gives feedback.** Completing an OAuth sign-in (or any provider-config change) now re-probes readiness on the runner before refetching, so the row's readiness dot and subtitle flip live instead of showing a stale snapshot. Previously the OAuth path refetched a cached snapshot and appeared to do nothing.
- **Honor `provider.model` from config.** Turns fell back to the provider catalog's first model when `provider.model` wasn't applied; for the Anthropic/claude-code catalog that first entry is a reasoning-tier model some subscriptions can't access (the API 404s "use Opus instead"). The configured model is now applied as the session's initial model.
