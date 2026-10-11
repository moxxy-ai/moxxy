---
title: Provider OAuth login
description: moxxy login openai-codex — and how the generic OAuth plugin powers it.
---

Most providers use API keys. Three providers use a **subscription** instead:
`openai-codex` (`@moxxy/plugin-provider-openai-codex`, shown as **ChatGPT — Moxxy**)
and `codex-agent` (`@moxxy/plugin-provider-codex-agent`, shown as **ChatGPT — Codex agent**)
for ChatGPT Pro/Plus, and `claude-code` (`@moxxy/plugin-provider-claude-code`) for Claude Pro/Max.
The generic `@moxxy/plugin-oauth` plugin handles the dance for any provider
that wires the same hook.

## Log in

```sh
moxxy login openai-codex
# Opens your browser, listens on http://localhost:8765/callback,
# exchanges the code for tokens, stores them in the vault.
```

`moxxy login` is generic: it walks the provider registry and any
`ProviderDef` with `auth: { kind: 'oauth' }` becomes loggable. There's
no provider-specific code in the CLI — the plugin owns the flow.

| Command | Effect |
|---|---|
| `moxxy login <provider>` | Run the login flow. |
| `moxxy login status [<provider>]` | Show stored creds (no secrets printed). |
| `moxxy login logout <provider>` | Remove stored creds. |
| `moxxy login --no-browser` | Force the headless device-code flow. |

The `--no-browser` flag (or a non-TTY stdin) triggers RFC 8628 device-code
flow — useful when you're SSH'd into a box without a local browser. You
complete the flow on your laptop's browser; the daemon polls for the
token.

## How the Codex provider wires it

```ts
export const openaiCodexProviderDef = defineProvider({
  name: 'openai-codex',
  models: [...codexModels],
  createClient: (config) => new CodexProvider(config),
  auth: {
    kind: 'oauth',
    serviceName: 'ChatGPT Pro/Plus',
    login: codexLogin,
    logout: codexLogout,
    status: codexStatus,
  },
});
```

`codexLogin` (see `packages/plugin-provider-openai-codex/src/login.ts`)
uses helpers from `@moxxy/plugin-oauth` — PKCE generation, code
exchange, device-flow polling — and stores the resulting bundle in
the vault under `oauth/openai-codex/*`.

Refresh tokens rotate on every refresh (single-use), so the provider's
`onTokensRefreshed` callback writes the new bundle back to the vault
before the next API call goes out. Lose that and you get one 401 then
permanent failure.

## Claude (Pro/Max) subscription — `claude-code`

The `claude-code` connection, shown as **Claude Agent**, does not call a model
for Moxxy. Claude Code itself does each turn, through the Claude Agent SDK, with
its own prompt, tools, skills, settings and MCP servers, on your Claude Pro/Max
sign-in. Moxxy shows what it does, asks you before it runs a tool, shows its
questions, and lends it Moxxy's own tools (the browser, memory, views) over a
local MCP server. Set it active with:

```yaml
# moxxy.config.yaml
provider:
  name: claude-code
```

You need Claude Code installed and signed in:

```sh
claude auth login        # or: moxxy login claude-code
claude auth status
```

The first time the connection is used, Moxxy installs the Claude Agent SDK into
`~/.moxxy/agents/claude-agent-sdk/<version>` with npm. It runs your installed
`claude` (from `PATH`, or `CLAUDE_CODE_EXECUTABLE=/absolute/path/to/claude`);
the SDK's own copy of the CLI is not downloaded.

In the desktop app, pick **Claude Agent** in onboarding or under
**Settings → Providers** and sign in there. No terminal is needed. **Sign in** opens your browser, and
the sign-in usually finishes on its own when you approve it. If the browser shows a code
instead, paste it into the sign-in dialog. Under the hood the desktop drives
`claude auth login` of the installed Claude Code, so Claude Code must be installed.
The desktop ships the connection with its bundled extensions, so it's there on
first launch with no separate install. The CLI installs it on first use: select
"Claude Agent" in `moxxy init`.

What carries over, and what does not:

- **Approvals.** Claude asks before a tool; Moxxy shows that as its usual
  approval, and its permission rules (`~/.moxxy/permissions.json`, plugin
  hooks) apply to Claude's tools too. Turning on auto-approve switches *this
  conversation's* Claude to bypass mode; Claude's own settings are never edited.
- **Modes.** Plan mode runs Claude in its plan mode and shows its plan for
  approval. Goal mode uses Claude's own `/goal`, and ends when Claude says the
  goal is met.
- **Conversations.** Each Moxxy conversation keeps one running Claude, and
  resumes Claude's own session after a restart.
- **Credentials.** Claude Code owns its login files; Moxxy neither reads nor
  stores them.

> **Heads-up:** Anthropic's consumer terms intend subscription sign-ins for
> official Claude clients. Claude Code is the client here; use it with that in mind.

## ChatGPT through Codex — `codex-agent`

The `codex-agent` connection, shown as **ChatGPT — Codex agent**, is the Codex
counterpart of Claude Agent: Codex itself does each turn through
`codex app-server`, with its own instructions, config, tools, skills and MCP
servers, on your ChatGPT sign-in. (**ChatGPT — Moxxy**, `openai-codex`, is the
other way round: Moxxy does the work with ChatGPT models.) Set it active with:

```yaml
# moxxy.config.yaml
provider:
  name: codex-agent
```

You need the Codex CLI installed and signed in:

```sh
codex login              # or: moxxy login codex-agent
codex login status
```

Moxxy runs your installed `codex` (from `PATH`, or
`CODEX_EXECUTABLE=/absolute/path/to/codex`) and installs nothing of its own.

- **Approvals.** With auto-approve off, the conversation's Codex asks before
  commands and file changes run outside its read-only sandbox, and Moxxy shows
  that as its usual approval. Auto-approve gives *this conversation's* Codex full
  access; `~/.codex/config.toml` is never edited. A Codex that is already set to
  full access starts with auto-approve on. Codex's answer to an approval carries
  no reason, so when you decline, Moxxy hands your reason to its running turn
  (or its next message, if the turn can no longer take input).
- **Fast mode.** Moxxy's fast mode runs the conversation's Codex on its fast
  tier (Codex's `/fast`); turned off, Codex goes back to its own setting.
- **Stop.** Stop interrupts Codex's turn, its Computer Use and other tools
  included; the next message carries on in the same thread.
- **Modes.** Plan mode runs Codex in its plan mode: its questions become Moxxy
  questions (an own answer always fits) and its finished plan is shown in the
  plan card. Goal mode sets Codex's own thread goal; Codex keeps working through
  turns until it says the goal is met, and Moxxy's goal mode ends with it.
- **Conversations.** Each Moxxy conversation keeps one running Codex, and
  resumes Codex's thread after a restart.
- **Credentials.** Codex owns its login files; Moxxy neither reads nor stores them.

## Using OAuth in your own plugin

The `@moxxy/plugin-oauth` plugin contributes three tools:

| Tool | Purpose |
|---|---|
| `oauth_authorize` | Run the loopback or device-code flow for a configured provider. |
| `oauth_get_token` | Fetch / refresh the current access token. |
| `oauth_clear_token` | Drop stored creds. |

…and exports the same helpers (`runAuthorizationCodeFlow`,
`runDeviceCodeFlow`, `refreshAccessToken`, `computeCodeChallenge`,
`generateCodeVerifier`, `generateState`) so a provider plugin can call
them directly without going through the model.

Tokens persist under `oauth/<provider>/*` in the vault, so subsequent
sessions inherit them. The plugin's bundled skills explain the
provider-side setup (e.g. Google Cloud Console for Workspace OAuth).
