---
title: Provider OAuth login
description: moxxy login openai-codex — and how the generic OAuth plugin powers it.
---

Most providers use API keys. Three providers use a **subscription** instead:
`openai-codex` (`@moxxy/plugin-provider-openai-codex`, shown as **ChatGPT — Moxxy**)
and `codex-agent` (`@moxxy/plugin-provider-codex-agent`, shown as **ChatGPT — Codex agent**)
for ChatGPT Pro/Plus, and `claude-code` (`@moxxy/plugin-provider-claude-code`) for Claude Pro/Max.
`opencode` (`@moxxy/plugin-provider-acp`, shown as **OpenCode agent**) uses
whatever your own OpenCode is set up with.
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
  The switch shows the mode Claude really runs in. Something outside Moxxy may
  only make Claude ask more: such a change turns the switch off at once. A
  change that would let Claude act without asking while the switch is off
  (bypass or auto mode) is set back at once, because only you turn
  auto-approve on.
- **Modes.** Plan mode runs Claude in its plan mode and shows its plan for
  approval. Goal mode uses Claude's own `/goal`, and ends when Claude says the
  goal is met.
- **Conversations.** Each Moxxy conversation keeps one running Claude, and
  resumes Claude's own session after a restart. A session Claude no longer
  keeps (it clears old ones, by default 30 days after their last use) is
  replaced by a new one that starts from Moxxy's record of the conversation;
  see [Conversations outlive the agent's session](#conversations-outlive-the-agents-session).
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
  full access starts with auto-approve on. Once the conversation has run, the
  switch stays as you left it, also when Moxxy starts a new Codex process that
  resumes the thread. When the thread's approvals change without Moxxy, Codex
  reports it, and the same rule applies as for Claude: a change that makes
  Codex ask more is kept and turns the switch off; a looser one (fewer
  approvals, a wider sandbox, or Codex's own reviewer in place of you) is set
  back. Codex's answer to an approval carries
  no reason, so when you decline, Moxxy hands your reason to its running turn
  (or its next message, if the turn can no longer take input). While
  auto-approve is off, you answer those approvals, not Codex's own reviewer
  (`approvals_reviewer = "auto_review"`); with it on, your reviewer setting stays.
- **Thinking.** Codex streams a summary of its thinking only when asked, so
  Moxxy asks for one (`auto`) unless your config sets `model_reasoning_summary`.
- **Fast mode.** Moxxy's fast mode runs the conversation's Codex on its fast
  tier (Codex's `/fast`); turned off, Codex goes back to its own setting.
- **Stop.** Stop interrupts Codex's turn, its Computer Use and other tools
  included; the next message carries on in the same thread.
- **Modes.** Plan mode runs Codex in its plan mode: its questions become Moxxy
  questions (an own answer always fits) and its finished plan is shown in the
  plan card. Goal mode sets Codex's own thread goal; Codex keeps working through
  turns until it says the goal is met, and Moxxy's goal mode ends with it.
- **Conversations.** Each Moxxy conversation keeps one running Codex, and
  resumes Codex's thread after a restart. If Codex fails to read the thread,
  Moxxy tries once more and then shows the error, starting no other thread, so
  the history is kept for your next message. Only a thread Codex no longer has
  is replaced by a new one, which starts from Moxxy's record of the conversation.
- **Credentials.** Codex owns its login files; Moxxy neither reads nor stores them.

## OpenCode — `opencode`

The `opencode` connection, shown as **OpenCode agent**, hands each turn to
OpenCode itself through `opencode acp` (the Agent Client Protocol), with its own
instructions, config, tools, skills, permission rules, MCP servers and models.
Set it active with:

```yaml
# moxxy.config.yaml
provider:
  name: opencode
  # any model `opencode models` lists
  model: opencode/big-pickle
```

You need OpenCode installed. Its free models need no sign-in; for other model
providers, sign OpenCode in from a terminal:

```sh
opencode auth login      # or: moxxy login opencode
opencode auth list
```

Moxxy runs your installed `opencode` (from `PATH`, or
`OPENCODE_EXECUTABLE=/absolute/path/to/opencode`) and installs nothing of its own.
The model picker offers what `opencode models` lists.

- **Approvals.** The auto-approve switch shows how OpenCode really runs. On
  its defaults OpenCode edits files and runs commands without asking, so the
  first message turns auto-approve on. Turn it off and Moxxy restarts that
  conversation's OpenCode once, with your own rules passed in for that process
  only (`OPENCODE_CONFIG_CONTENT`): what they allow becomes an ask, what they
  deny stays denied. It then asks before edits, commands and web requests, and
  Moxxy shows each ask as its usual approval; turning auto-approve back on
  needs no restart, Moxxy answers the asks itself (your standing deny rules
  still refuse). Work outside the project folder, which OpenCode asks about
  even on its defaults, still comes to you while auto-approve is the one the
  first message turned on; once you switch it yourself, Moxxy answers that too.
  If your rules already ask, auto-approve stays off. A new OpenCode process
  that loads the session keeps the switch as you left it (and, unable to tell
  who turned it on, keeps asking you about work outside the project). OpenCode's
  config files are never edited. OpenCode ends its turn when you decline, so
  Moxxy hands it your reason as its next message in the same turn.
- **Stop.** Stop cancels OpenCode's prompt; the next message carries on in the
  same session.
- **Modes.** Plan mode runs OpenCode in its plan mode (no file edits). OpenCode
  has no plan hand-off or goal of its own, so Moxxy lends it `plan_complete` and
  the goal tools over MCP: its plan is shown in the plan card, and in goal mode
  it keeps working until it calls `goal_complete`. Its questions go through
  Moxxy's `ask_user`.
- **Conversations.** Each Moxxy conversation keeps one running OpenCode, and
  loads OpenCode's session after a restart. OpenCode reports a missing session
  and a failed load alike, so Moxxy checks OpenCode's session list: a session
  still there is tried once more and otherwise the error is shown, with no other
  session started; only a session OpenCode no longer has is replaced by a new
  one, which starts from Moxxy's record of the conversation.
- **Credentials.** OpenCode owns its login files; Moxxy neither reads nor stores them.

## Conversations outlive the agent's session

A Moxxy conversation lasts until you delete it. The agent's own session (Claude's
session, Codex's thread, OpenCode's session) only holds what the agent
remembers, and Moxxy keeps the whole conversation itself. When an agent starts
a new session while the conversation already has turns (its earlier session is
gone, or you switched agents partway), its first message carries the
conversation so far from that record:

- the latest turns word for word, up to about 16k tokens;
- one line for every older turn, in your own words;
- a note that this is history to work from, not a new request.

Switching agents keeps the conversation but not the model: a message that names
no model runs on the new agent's default, never on the model of the agent before.

Tool output and file contents are not repeated; the agent reads files again when
it needs them. Each agent also gets Moxxy's `recall` tool, which searches the
whole conversation (`recall({ query: "database port" })`) and reads any turn in
full (`recall({ turn: 12 })`), so a detail from long ago is still found.

## The Moxxy tools an agent sees

Claude, Codex and OpenCode each read their list of Moxxy tools once, as their
session opens. So Moxxy lists every tool of the conversation, in every mode,
from the start, and the list stays the same when you switch modes. A tool the
current mode does not offer (`ask_user` in goal mode, say) is still listed;
calling it runs nothing, and the agent is told why, for example
"ask_user is not available in goal mode, so Moxxy did not run it". The refusal
shows in the conversation like any other tool result.

When the list itself changes, because you installed or enabled a plugin
partway through a conversation:

- Claude and OpenCode are told the list changed and read it again before the
  next message.
- Codex does not re-read a list it already has, so Moxxy restarts its
  `codex app-server` and resumes the same thread, which reads the new list.
  The conversation carries on; only the process is new.

## File changes show as diffs

When Claude, Codex or OpenCode creates or edits a file, the conversation shows
the change as a diff, the same way it shows an edit Moxxy makes itself: the
file's path inside the project, the added and removed lines with their line
numbers, and a few lines around each change. Moxxy builds it from what the agent
reports about its own edit:

| Agent | Edit | New file |
|---|---|---|
| Claude | the patch its Edit or Write reports | the content Write was given |
| Codex | the unified diff of a `fileChange` | the content of an `add` |
| OpenCode | the unified diff in the edit's metadata | the content `write` was given, when the file did not exist |

Some changes stay as the text the agent sent, because the agent does not report
enough for a diff: a Codex change that touches several files at once or deletes
a file, and an OpenCode `write` that replaces a file that already existed (OpenCode
does not send the old content).

## Images an agent looks at

When Claude, Codex or OpenCode looks at an image during its work, the
conversation shows it under the tool's line: a screenshot it takes while it
controls the computer, an image file it reads. Click it to see it full size.
The terminal says how many images came back, with their kind and size. Every
image a tool call returned is shown, side by side; an image sent twice shows
once (Codex's computer use sends each screenshot twice).

| Agent | Where the image comes from |
|---|---|
| Claude | an image block in the tool's result |
| Codex | an image in an MCP tool's result, or the file `view_image` names (read from disk, up to 8 MB) |
| OpenCode | an image in the finished call's content |

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
