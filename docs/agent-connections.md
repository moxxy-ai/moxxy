# Agent connections

A model connection is one of two kinds:

- **API connection.** Moxxy runs the work: its own loop calls the model, runs the tools and keeps the context.
- **Agent connection.** The vendor's own coding agent runs the work, from the CLI already on your computer, with its own prompt, tools, settings, skills and context handling. Moxxy shows the run in its own interface, answers the agent's approvals and questions in its own windows, and lends the agent its browser, computer control and mode tools.

The point of an agent connection is the vendor's result: the same model gives the same work in Moxxy as in the vendor's own tool. Why it is built this way, and what that costs, is in [ADR 0001](adr/0001-agent-connections-run-the-vendor-agent.md).

Per-agent detail (what each agent reports, how each one's sign-in, approvals and conversations work) is in the [provider sign-in guide](../apps/docs/src/content/docs/guides/provider-oauth-login.md).

## The three agents

| In the model picker | Connection name | Runs | Signs in with | Models |
|---|---|---|---|---|
| Claude Agent | `claude-code` | Claude Code, through the Claude Agent SDK | your Claude Pro or Max sign-in (`claude auth login`) | the ones your Claude Code offers |
| ChatGPT — Codex agent | `codex-agent` | Codex, through `codex app-server` | your ChatGPT sign-in (`codex login`) | the ones your Codex offers |
| OpenCode agent | `opencode` | OpenCode, through `opencode acp` (the Agent Client Protocol) | nothing for OpenCode's free models; `opencode auth login` for any other provider | the ones your OpenCode setup offers; `opencode/big-pickle` before it is switched on |

Moxxy reads only whether the agent is signed in, and as whom. It never copies, stores or refreshes the agent's tokens.

The Claude Agent SDK is not part of Moxxy. The first time the Claude connection is used, Moxxy installs it with your npm into `~/.moxxy/agents/claude-agent-sdk/`, without the CLI it would bring along: Moxxy always runs your own Claude Code.

## Setting one up

**In the desktop.** First-run setup and Settings → Providers show one row per agent: whether its CLI is installed, its version, the account it is signed in with, and one main action (Install, Sign in, Update). Install runs the vendor's installer with a progress bar.

**In the terminal.**

```sh
moxxy agents status              # each agent: installed version, the latest, what to do next
moxxy agents install codex       # the vendor's installer
moxxy agents update claude       # the agent's own update command
moxxy login claude-code          # the vendor's own sign-in (also codex-agent, opencode)
moxxy doctor                     # includes the agent CLIs
```

Moxxy looks for each CLI on `PATH` first, then where the vendor's installer puts it (`~/.local/bin` for Claude and Codex, `~/.opencode/bin` for OpenCode). On macOS and Linux the desktop app asks your login shell once at start for the `PATH` your terminal has and puts it first, so it finds the same CLI the terminal runs, also when two are installed (an old Homebrew `claude` and a current one in `~/.local/bin`). A shell that fails makes way for your account's own shell and then `/bin/zsh` (macOS) or `/bin/bash` (Linux); one that does not answer within 5 seconds is stopped, with anything its profile started, and ends the search; on macOS the `PATH` launchd gives apps is used. Run from a terminal, the app logs which shell answered and how long it took (`terminal PATH: ...`).

When no shell answers, the app adds the usual GUI folders (`/usr/local/bin`, `/opt/homebrew/bin`, nvm's) behind the `PATH` it started with and names them in `MOXXY_PATH_FALLBACK`. An agent CLI in one of those comes after the vendor installer's copy, so an old Homebrew `claude` never wins over a current `~/.local/bin/claude` just because the shell was slow. Of nvm's node versions, the one a new terminal gets (nvm's `default` alias, also through `lts/*` or `node`) comes first and the rest newest first, so an OpenCode installed under an old node no longer wins over the one under your default node; nvm in another folder is found through `NVM_DIR`. A folder your terminal's `PATH` has is never a fallback and keeps its place. The version check, a conversation and **Update** all use the same copy. To point at another file, set `CLAUDE_CODE_EXECUTABLE`, `CODEX_EXECUTABLE` or `OPENCODE_EXECUTABLE`; the check, a conversation, **Update** and `moxxy agents` all use that file.

| Agent | Installer | Update command | Oldest version Moxxy accepts |
|---|---|---|---|
| Claude Code | `curl -fsSL https://claude.ai/install.sh \| bash` (Windows: `irm https://claude.ai/install.ps1 \| iex`) | `claude update` | 2.1.296 |
| Codex | `curl -fsSL https://chatgpt.com/codex/install.sh \| sh` (Windows: `irm https://chatgpt.com/codex/install.ps1 \| iex`) | `codex update` | 0.155.1 |
| OpenCode | `curl -fsSL https://opencode.ai/install \| bash` (Windows: `npm install -g @opencode/cli`) | `opencode upgrade` | 1.19.0 |

## Versions and updates

Moxxy checks every agent CLI when it starts and every hour after that: installed or not, signed in or not, and its version against the vendor's newest release on npm (`@anthropic-ai/claude-code`, `@openai/codex`, `@opencode/cli`). The answer is kept in the session, so every surface says the same:

- the desktop shows one line above the message box. An optional update can be closed and stays closed until the next version; a required one cannot;
- the terminal UI shows the same line above the prompt;
- `moxxy doctor` and `moxxy agents status` list it.

Every notice names the file it is about and, when it can tell, where it came from: `Claude Code 2.1.63 at /opt/homebrew/bin/claude (Homebrew) is older than Moxxy works with`.

A CLI older than the version Moxxy was checked against must be updated before the connection runs. How it is updated depends on where the file really is (links followed):

| The copy | Update |
|---|---|
| The vendor's installer (`~/.local/bin`, `~/.opencode/bin`), a global npm install, or anything else | the agent's own command (`claude update`, `codex update`, `opencode upgrade`) |
| Homebrew (`Caskroom` or `Cellar`) | `brew upgrade [--cask] <name>` with the Homebrew it belongs to; the agent's own command when that `brew` is not there |
| Inside a macOS app (`*.app/Contents/`, e.g. the Codex in ChatGPT.app) | none: the app updates it, so Moxxy offers no **Update** and runs nothing |

Moxxy never removes a copy, and the desktop never updates an agent during a turn. The desktop puts the Node it installed for you first on its own `PATH`; the agent's own update runs with that folder last, so an update that asks `npm` how the agent was installed (`opencode upgrade` does) reaches the npm of your terminal, the one that installed it. An agent that lives in the desktop's Node folder keeps it first.

## Who does what

| Part of the work | On an agent connection |
|---|---|
| Reading, editing, searching, running commands | The agent, with its own tools. Edits show in the conversation as diffs. |
| The browser and computer control | Moxxy's, lent to the agent over Moxxy's local MCP server (`browser_*`, `computer_*`). You watch the agent in the Browser pane and can take over. The agent's own MCP servers stay as it has them; Moxxy adds only this one. |
| Other Moxxy tools | Lent the same way: `recall`, the mode tools, and the tools of MCP servers you added in Moxxy (Moxxy runs those servers). Tools the agent has its own of (files, shell, web, questions, memory, skills) are not lent, and neither are the tools of an MCP server the agent has set up under the same name: the agent uses its own. Claude and Codex get these tools behind a catalog of three small ones, so their full descriptions are not in every request: `find_tools` names the groups (an MCP server, or tools such as `browser_*`) and finds a tool by what it does, `describe_tools` gives a tool's input, and `call_tool` runs it. The conversation shows the tool that ran, never the catalog steps. OpenCode gets the tools one by one. |
| Skills | Your Moxxy skills (the project's and your user folder's, synthesized ones too) reach the agent through one more lent tool, `load_skill`, which lists them; one added later is found by name. A skill file saved to a skills folder while the conversation runs reaches the agent at its next turn: Moxxy reads the skill folders again before each agent turn. A Moxxy feature's skill (Moxxy Browser, Computer Use) comes with that feature's tools. Moxxy's other built-in skills stay out, and a skill named like one of the agent's own is left to the agent's. |
| Context within a turn | The agent's. Moxxy's compaction, elision and prompt cache work only on Moxxy's side. |
| Instructions | The agent's own (`CLAUDE.md`, `AGENTS.md`, its settings). Moxxy adds nothing to its prompt, and its own conduct rules are not sent. |

The local MCP server listens on `127.0.0.1` only, needs a token the agent gets in its environment, and refuses browser requests. Every Moxxy tool the agent calls through it goes through the permission engine like any other call.

## Approvals and auto-approve

Without auto-approve the agent asks before it acts, and Moxxy shows the question in its own approval window. Your standing rules in `~/.moxxy/permissions.json` answer first. They reach every one of Claude's own tool calls, through Claude's hook that runs before each tool, and every call Codex or OpenCode asks about.

Auto-approve is **one state shared with the agent**, never a separate Moxxy flag that could disagree with it:

- when a conversation opens, Moxxy reads the agent's real setting and shows it. A Codex config that never asks shows as auto-approve on;
- turning auto-approve on or off in Moxxy changes the agent for this conversation only. Moxxy never writes the agent's own configuration (`~/.codex/config.toml`, Claude's settings, `opencode.json`);
- when the conversation goes to another connection, a switch you set stays as you set it, on every agent, both ways. Until you set it, each agent runs as it is set up on its own, and that does not carry over: coming back from a Codex that never asks to a Claude whose settings ask or name no mode, Claude asks again, as does a model provider of Moxxy's own;
- a change made to the agent from outside Moxxy may only make it stricter. Moxxy follows a stricter setting and never loosens it back; a looser one while auto-approve is off is set back at once. Only you turn auto-approve on.

| Agent | Auto-approve on means |
|---|---|
| Claude | permission mode `bypassPermissions` |
| Codex | approval policy `never` with full access |
| OpenCode | Moxxy answers OpenCode's questions with yes. What OpenCode's own rules still ask about (work outside the project) is still asked, unless you turned auto-approve on yourself. |

With auto-approve off, a Codex set up never to ask holds every command but a known-safe read, and every edit, until you answer (approval policy `untrusted`). Codex itself holds them, so you are asked whatever the model decides; under `on-request` it was the model's call, and it mostly tried the write, was blocked and gave up. Its sandbox is the workspace (`workspaceWrite`), not read-only: told it may only read, the model at times declined a change without trying, so Codex never got to ask. A Codex that no longer takes `untrusted` gets `on-request` with a read-only sandbox instead, and the live check (`pnpm test:agents:live`, "asks before a change") says so.

## Questions

When the agent asks you something (Claude's `AskUserQuestion`, Codex's questions in plan mode), Moxxy shows it exactly as the agent sent it, with its suggestions and room for your own answer. It is the same question card as `ask_user` on an API connection, so the desktop, the terminal UI, Telegram, Discord and the phone show the same one, and the first answer closes it everywhere.

## Modes

Every Moxxy mode works on an agent connection. Where the agent has its own version of a mode, Moxxy uses it.

| Mode | On an agent connection |
|---|---|
| Default | One message is one turn of the agent. The agent decides when its turn is done; Moxxy does not nudge it. |
| Plan | The agent's own plan mode (Claude `plan` permission mode, Codex plan collaboration mode, OpenCode `mode=plan`). The finished plan is the same plan card as on an API connection, with Implement, Run as goal, Rewrite and Dismiss. Claude's plan comes from `ExitPlanMode`, or from its plan file when it only rewrote that file; an agent that writes its plan as a plain message is asked once to hand it over. |
| Goal | Claude and Codex: the agent's own goal (Claude `/goal`, Codex thread goals). Moxxy shows the goal and its status and does not nudge. OpenCode, which has no goal of its own: Moxxy's goal loop, which sends follow-ups until OpenCode calls `goal_complete` or `goal_abandon`. Stop ends the run and keeps the goal; your next message resumes it. |
| Research | Every sub-question runs in its own agent session; the summary is a turn of the parent session. |

A turn the agent starts by itself (a helper it left working finished) opens its own entry in the conversation, "agent continued", on every surface. It does so also when the conversation went to another connection and came back while the work ran. On the desktop that entry opens the work that ended in the Agents pane. Work the person stopped opens no such turn on Codex; Claude decides for itself whether to answer a stopped task.

## Background work

Claude and Codex can leave work running after their turn: a helper agent that goes on, or a command such as a dev server. OpenCode can leave a helper running: its `task` tool with `background: true` (OpenCode 1.19, behind `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS`, which Moxxy turns on unless you set it yourself). OpenCode has no background commands. Moxxy records the work in the conversation as it happens, not at the agent's next turn:

- what runs now, as one list that replaces the one before (`background_work`, from Claude's `background_tasks_changed`, Codex's commands and subagents, and OpenCode's background subagents);
- each command's end, with how it ended and the last 4 KB it printed (`background_work_ended`; Claude's task output file, Codex's `aggregatedOutput`);
- each helper's steps, what it says as it works (`subagent_message`), and its answer, also between turns.

The list of what runs now is also part of the session's info (`SessionInfo.backgroundWork`), held in memory: after a restart of the runner nothing shows as running that no longer runs. Stop on one work (`session.stopBackgroundWork`, runner protocol v29) stops a Claude task (`stopTask`), ends a Codex command (`thread/backgroundTerminals/terminate`) or interrupts a Codex subagent's own turn (`turn/interrupt`; Codex 0.163 reports that only as the subagent's turn ending `interrupted`, so that ends it), or aborts an OpenCode subagent's session. A stopped helper is recorded as stopped, not as failed. Nothing can be sent to a helper while it works. A command's output shows once it ends; there is no live tail yet.

ACP reports none of OpenCode's background work, so Moxxy reads it from OpenCode's own HTTP API, which OpenCode 1's `opencode acp` serves beside ACP. OpenCode 2's `opencode acp` runs a private server with no port and refuses `--port`, so Moxxy starts it with `acp` alone (also when it cannot read the version) and lists none of its background helpers yet. For OpenCode 1, Moxxy starts OpenCode with a port it picked (`--port`, on `127.0.0.1`) and a password only it knows (`OPENCODE_SERVER_PASSWORD`), reads OpenCode's event stream (`GET /event`) for the helpers' steps and ends, and stops one with `POST /session/{id}/abort`. The same stream shows a helper's steps while the turn waits for it, which ACP does not report either. When a background helper finishes, OpenCode answers its result by itself; Moxxy opens a turn for that ("Agent continued") and shows OpenCode's reply in it. A helper you stopped opens no such turn. Stop on a turn of the conversation makes OpenCode cancel its background helpers too; they are recorded as stopped.

The desktop shows all of it in the Agents pane of the work panel, and says above the message box what runs in the background. Every surface reads the same log and the same info, and a phone can stop work through the same command.

## Effort, models and fast mode

The model list and effort levels come from the agent. With the hourly CLI check, Moxxy asks a signed-in Claude (`supportedModels()` of the Agent SDK, on a query that is sent no message), Codex (`model/list` of `codex app-server`) and OpenCode (`opencode models`) which models they offer, so a new model shows in every picker within the hour, as it does in the agent's own CLI, even while another connection runs the conversation. Until an agent has answered, or when it cannot, the connection's built-in list stands; asking spends no usage. Claude is asked only once its Agent SDK is installed (on first use of the connection). A model the conversation already runs keeps running when the agent stops listing it.

The context window a model shows starts from the built-in list (Codex's defaults: 500k for GPT-6.1 Sol, 272k for the other GPT-6 and GPT-5.6 models; 200k for every OpenCode model; 400k for a Claude or Codex model Moxxy does not know). After the agent's first response it is the window the agent reports it runs the model with: Codex's `modelContextWindow` (which follows `model_context_window` in the person's Codex config), the turn model's `contextWindow` in Claude's `modelUsage`, and the `size` of OpenCode's `usage_update`. The window is recorded in the conversation's log, so the usage bar on every surface shows the same number. How full the bar is comes from the agent too: the prompt of Claude's last call (the usage on its last assistant message), the `used` of OpenCode's `usage_update`, and the prompt of Codex's last call. A turn's usage adds up every call the agent made (ten tool steps over a 150k conversation add up to 1.5M), so it counts toward cost and limits but never stands for the size of the conversation. The agent still owns its context and compaction; the number only sizes Moxxy's view. An agent runs at Low effort until you pick another, and offers Low, Medium, High and Extra high (there is no Off: the agent always thinks). Fast mode runs the agent on its own faster tier where it has one (Codex's priority tier).

## In the conversation

- Edits are diffs; images a tool returned (screenshots) show under its row; the agent's step list is one list updated in place; the agent's own subagents show as subagent rows.
- Thoughts one after another fold into one "Thinking" row with their count.
- The agent's account limit (for example "Claude has used 56% of its weekly limit · resets Wed at 05:00") is in the desktop's Model & usage window. A turn that stopped on a used-up limit ends with a "Limit" note instead of the agent's raw error. OpenCode says only that a limit is used up (its free tier, its Go plan), not how much of one is used: when it stops to wait for the reset, which can take hours, Moxxy ends the turn with the same note.
- Images you attach go to the agent as images; other files are passed as files.
- Stop ends the turn and the commands that turn started. Codex keeps a stopped turn's commands running on its own, so Moxxy ends them (`thread/backgroundTerminals/terminate`); a dev server an earlier turn left running keeps running.
- Switching to another connection in the middle of a conversation tells the new agent that it joins partway and hands it the earlier turns. Switching back hands the first agent the turns it was away for. The record ends by saying that the person's newest message comes next; Claude gets it in a message of its own, just before the person's message. A conversation reopened after a restart resumes the agent's own session.
- Moxxy's one-off requests to the agent (summaries, skill drafts, memory, the research plan) pass their instructions as the agent's instructions, apart from the text it works on. On Claude they load none of the person's MCP servers or claude.ai connectors: a one-off request has one step, so a tool call there could only fail. The person's turns keep every server.

## Things to know

- **Limits on running agents.** Every live agent session is a process of a few hundred megabytes, so each agent keeps at most 8 live sessions at a time.
- **The agent's native tools are not isolated by Moxxy.** Moxxy's isolators do not apply to them; the agent's own sandbox and permission hooks do.
- **The agent keeps its own history.** Conversations also land in the agent's own history (`~/.claude/projects`, `~/.codex`), and Claude's plan mode writes plan files to `~/.claude/plans`.
- **Vendor terms.** Anthropic's Agent SDK terms say third-party products need Anthropic's approval to offer claude.ai sign-in. Using a Claude subscription through Moxxy is the owner's deliberate choice; decide for yourself whether it fits your use.

## For developers

- The seam: a provider with `agentStep()` hands each round to the vendor's agent inside `runReactLoop`, so every mode keeps working. How to write one is in [the provider author guide](../.ai/agents/provider-author.md).
- Shared parts (the Moxxy tools MCP server, the JSON-RPC client, the session pool, CLI checks) live in `@moxxy/agent-connection-kit`.
- Terms used here are defined in [GLOSSARY.md](../GLOSSARY.md).
