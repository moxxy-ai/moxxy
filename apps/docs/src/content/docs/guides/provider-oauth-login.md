---
title: Model account sign-in
description: Sign in through the installed Claude Code, Codex or OpenCode connection.
---

Use **ChatGPT — Codex agent** (`codex-agent`) for a ChatGPT account, **Claude
Agent** (`claude-code`) for Claude, or **OpenCode agent** (`opencode`) for your
OpenCode setup. The installed agent owns its credentials and runs the turn;
Moxxy does not exchange or refresh its tokens through a private model API.

```sh
moxxy login codex-agent
moxxy login claude-code
moxxy login opencode
moxxy login status
```

API-key connections such as OpenAI are configured with their API key instead.
The generic `@moxxy/plugin-oauth` remains available for integrations implementing
OAuth 2.0, PKCE or device-code profiles; it is independent of agent sign-in.

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
servers, on your ChatGPT sign-in.  Set it active with:

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
  its defaults OpenCode edits files and runs commands without asking, so
  auto-approve shows on from the moment a conversation opens. Turn it off and Moxxy restarts that
  conversation's OpenCode once, with your own rules passed in for that process
  only (`OPENCODE_CONFIG_CONTENT`): what they allow becomes an ask, what they
  deny stays denied. It then asks before edits, commands and web requests, and
  Moxxy shows each ask as its usual approval; turning auto-approve back on
  needs no restart, Moxxy answers the asks itself (your standing deny rules
  still refuse). Work outside the project folder, which OpenCode asks about
  even on its defaults, still comes to you while auto-approve is the one
  OpenCode's own rules turned on; once you switch it yourself, Moxxy answers
  that too.
  If your rules already ask, auto-approve stays off. A new OpenCode process
  that loads the session keeps the switch as you left it, and asks you about
  work outside the project only while the switch is the one OpenCode's own
  rules turned on. OpenCode's
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

## Installing and updating the agent CLIs

Moxxy checks the three CLIs when the terminal UI or `moxxy serve` (which the
desktop runs) starts, and every hour after: whether each is installed, signed
in, and as new as the vendor's latest release on npm. A CLI older than the
oldest version Moxxy was checked against (Claude Code 2.1.296, Codex 0.155.1,
OpenCode 1.19.0) must be updated before its connection runs. The desktop says
so in one line above the message box and in Settings → Providers, the terminal
in one line above the prompt, and `moxxy doctor` lists it.

```sh
moxxy agents status            # installed, latest, what to do next
moxxy agents install opencode  # the vendor's installer
moxxy agents update codex      # the agent's own update command
```

Install runs the vendor's own installer (on Windows its PowerShell installer,
and npm for OpenCode); update runs the agent's own command (`claude update`,
`codex update`, `opencode upgrade`), which knows how it was installed. Moxxy
never updates a CLI by itself, and the desktop does not update one while a
turn runs.

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

### Moxxy's browser

As it connects, the agent is told what Moxxy's tools are: they run in your
Moxxy conversation and ask you first when your settings say so. When the
conversation has Moxxy's browser, the agent is also told that its pages open in
the browser panel next to the chat in the desktop, where you watch it work and
can take over, and that it opens public pages only (not `localhost` or
private addresses). Whether to use it or its own tools is the agent's choice:
ask "open example.com in the browser I'm watching" and it uses Moxxy's
browser; ask what a page says and it may read it its own way. The first page
on a site asks you once to allow that site, as Moxxy's own agent does.

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

## The agent's list of steps

When Claude, Codex or OpenCode keeps a list of steps for a task, the
conversation shows it as one list per turn, updated in place as the agent
ticks steps off: done, in progress, waiting. The desktop also says, above the
message field while the turn runs, which step the agent is on. The terminal
draws the list as lines marked ✓, ● and ○.

| Agent | Where the list comes from |
|---|---|
| Claude | its task tools (`TaskCreate`, `TaskUpdate`, `TaskList`), or `TodoWrite` on older Claude Code |
| Codex | the plan it updates during a turn (`turn/plan/updated`) |

Codex has kept its checklist tool off by default since 0.152. Moxxy turns it
on for the conversations it starts (`tools.update_plan.enabled`, for that
conversation only; your Codex config is not written), unless your config sets
`[tools.update_plan] enabled` either way, in which case your choice holds.
| OpenCode | its `todowrite` tool, or a plan sent over ACP |

## When an agent uses your computer

When Claude, Codex or OpenCode controls your computer with its own tools (a
computer-use MCP server, or Codex's computer use), the desktop says so at the
top of the conversation, "Codex is using your computer", with the app it last
named and a Stop button that stops the turn. The terminal shows the same as a
line above the prompt; Esc stops it. It shows from the agent's first computer
call in the turn until the turn ends.

## Your Moxxy skills

The skills you keep in Moxxy (the project's `.moxxy/skills`, your
`~/.moxxy/skills`, and the ones Moxxy writes for you) reach Claude, Codex and
OpenCode as one more Moxxy tool, `load_skill`. Its description lists each skill
by name with what it is for; the agent calls it with a name when your request
matches, and gets that skill's instructions. With many skills the description
lists as many as fit and the agent can ask for the full list. Reading a skill
never asks you for permission.

- Moxxy's own built-in skills stay out: the agent has its own. The skill of a
  Moxxy feature whose tools the agent is lent comes along (Moxxy Browser,
  Computer Use).
- When the agent has a skill of the same name itself, Moxxy leaves yours out
  and the agent uses its own.
- A skill saved during the conversation reaches the agent at its next message,
  the same way a new tool does. Claude keeps the list it read when the
  conversation started, so it finds a newer skill by asking for the full list.
- Claude and Codex keep most tools behind a search and show the model only
  their names until it looks. Moxxy asks both to show `load_skill` upfront
  (Codex shows all of Moxxy's tools upfront), so the agent sees your skills
  without searching.

## Your account's usage limit

Claude and Codex tell Moxxy how much of your plan's usage they have left and
when it resets. The desktop shows it in the Model & usage window (the model
name under the message box), for example "Claude has used 56% of its weekly
limit · resets Wed at 05:00"; the terminal shows it in one line above the
prompt from three quarters of a window used. Once the limit is used up, the
turn ends with a "Limit" note saying which limit and when it comes back,
instead of the agent's raw error. The phone app, Telegram and Discord show the
note when a turn stops on the limit. When the agent says again that the limit
is used up without saying when it resets (Claude does, from its second message
on), the reset it gave before still shows; a limit whose reset has passed is no
longer shown. OpenCode does not report a limit, so nothing shows for it.

## Helpers an agent starts

When Claude, Codex or OpenCode hands part of the work to a helper agent of its
own, the conversation shows it the way it shows Moxxy's own sub-agents: a row
with the task, the tools the helper ran, its answer and the tokens it used.

| Agent | What Moxxy sees |
|---|---|
| Claude | its `Agent` tool (`Task` on older Claude Code), the helper's tool calls and its answer |
| Codex | a subagent working in a thread of its own: its tool calls, its answer and its tokens |
| OpenCode | its `task` tool and the helper's answer; OpenCode does not report the helper's own tool calls, so the row does not count them |

A helper still working when its turn ends shows "in the background" on its row.
What it does after that, up to its answer, shows in a row of its own at the
point in the conversation where it happened.

When Claude's background helper finishes between your messages, Claude goes on
by itself: Moxxy opens a turn for it at once, marked "Agent continued", with the
helper's work and Claude's report, so you do not have to write anything to see
it. Your next message gets only the answer to what you asked.

Codex does not go on by itself (checked with Codex 0.155.1), but its work can
outlast its turn: a helper it did not wait for, or a command it left running
in the background ("Still running in the background when Codex ended its
turn" on the command's row). When that work ends between your messages, Moxxy
opens the same "Agent continued" turn to show it, for example "check later
finished in the background" with the helper's tool calls and answer, or "A
command Codex left running finished" with the command's output. Codex is sent
nothing, and reads that output itself when you write next. If you write
first, it shows at the top of your turn. OpenCode waits for its helpers and
commands before it ends its turn, so nothing of its work comes later.

Telegram, Discord, Slack, Signal, WhatsApp and iMessage show such a turn too:
"agent continued: …", the helper's answer, then what the agent said.

Moxxy's rules (`~/.moxxy/permissions.json` and plugins that refuse calls) apply
to a helper's commands between turns too. A command no rule settles is not
asked about while no turn is open; Claude decides it by its own approvals.

## What an agent sends that has no place of its own

Each kind of thing Claude, Codex or OpenCode reports either has its place in
the conversation (a message, a tool call with its result, a plan, a helper's
row, the usage limit) or is left out on purpose: the agent repeating your own
message, it shortening its own context, notes meant for its own screen. Codex
shows the picture it generated (its image tool) under the call, and a pause as
a `Sleep`. A kind Moxxy does not know, from a newer version of the agent, is
not dropped: it shows as a tool call named after it, with what the agent said
about it. The tests list every kind each agent's protocol has (Codex 0.155.1,
the Claude Agent SDK 0.3.296, the Agent Client Protocol), so a newer version
that adds one fails them until someone decides where it goes.

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
