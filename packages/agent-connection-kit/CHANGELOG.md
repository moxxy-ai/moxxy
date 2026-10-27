# @moxxy/agent-connection-kit

## 0.1.0

### Minor Changes

- 71e90e5: You can now see what Claude's and Codex's background work does. The desktop's work panel has an Agents pane listing the chat's helpers and the commands the agent left running. Picking one opens its mini chat (the helper's task, what it said and the tools it called, its answer) or what a command printed when it ended, with Stop while it runs. "Agent continued" in the chat opens the work that ended there instead of repeating its name in a box, the pane can point back at that entry, and a line above the message box says what runs in the background. A helper's steps now show as they happen, not at the agent's next turn, and work the person stopped on Codex opens no empty "Agent continued" turn. Every surface reads the same records: the list of what runs now is part of the session's info, so a restarted runner shows nothing stale running.

  The SDK adds the `subagent_message`, `background_work` and `background_work_ended` agent step events, `subagent_completed.stopped`, `AgentBackgroundWork`, `AgentWorkEnd`, `AgentActivity`, `agentActivityRecord`, `isAgentWorkEvent`, `isSubagentEvent` (also in the browser-safe `@moxxy/sdk/agent-work` entry), `LLMProvider.onAgentActivity` and `stopBackgroundWork`, `AgentTurnStart.workId`, `TriggerOrigin.workId`, `SessionInfo.backgroundWork` and `ClientSession.stopBackgroundWork`. Runner protocol v29 adds `session.stopBackgroundWork`. `@moxxy/agent-connection-kit`'s `AgentSessionPool` gains `onActivity`, `activity` and `running`.

- 436496c: Agent connections can lend Moxxy's tools as a catalog of three small tools (`find_tools`, `describe_tools`, `call_tool`) instead of every tool one by one (`moxxyToolsHandler` / `idleToolsHandler` option `{ catalog: true }`). The catalog names the tool groups (an MCP server, or tools sharing a prefix such as `browser`), sorted so it reads the same however the tools were registered and the agent's prompt cache keeps matching; the agent looks a tool up and reads its input only when it wants it, and `call_tool` runs the real tool in the turn, so the chat shows that tool and never the catalog steps.

  ChatGPT — Codex agent: Moxxy's tools now reach Codex as that catalog. Lent one by one, their full descriptions went with every request Codex made, tens of thousands of tokens once the person's MCP servers were set up. Codex's own tools, skills and MCP servers are unchanged.

  Claude Agent: Moxxy's tools now reach Claude as that catalog too. Claude listed every one of them by name in each request, hundreds once the person's MCP servers were set up. Claude's own tools, skills and MCP servers are unchanged.

- 6e54a6b: Claude Agent connection: the `claude-code` provider now hands each turn to Claude Code itself through the Claude Agent SDK (installed into `~/.moxxy` the first time the connection is used), on the Claude Pro/Max sign-in. Claude keeps its own prompt, tools, skills and settings; Moxxy shows what it does, asks before each of its tools with the permission rules applied, shows its questions, runs plan and goal mode through Claude's own, and lends it Moxxy's tools over a local MCP server. The text mode and its `<moxxy_tool_calls>` protocol are gone. The SDK adds `req.sessionId` to `agentStep`, a `goal` event, and `onAgentGoal`, through which goal mode ends when the agent says its goal is met. `@moxxy/agent-connection-kit` is now published, since the connection installs from npm.
- 8472068: ChatGPT — Codex agent connection: the new `codex-agent` provider (`@moxxy/plugin-provider-codex-agent`) hands each turn to Codex itself through `codex app-server`, on the ChatGPT sign-in of the person's installed Codex CLI. Codex keeps its own instructions, config, tools, skills and MCP servers; Moxxy shows what it does and its approvals, turns its plan-mode questions into Moxxy questions and its plan into the plan card, runs goal mode through Codex's own thread goal (ending when Codex says it is met), and lends it Moxxy's tools over a local MCP server. Auto-approve gives only the current conversation's Codex full access; `~/.codex/config.toml` is never edited. The SDK adds a `plan` agent event and `onAgentPlan`, through which plan mode shows an agent's own plan in its card. `@moxxy/agent-connection-kit` gains `Inbox`, `untilStopped` and `transcript`. The `openai-codex` provider is now labelled "ChatGPT — Moxxy".

### Patch Changes

- d2de3a1: Updating OpenCode 1 to OpenCode 2 works. OpenCode 1's own `opencode upgrade` stays on version 1 and still reports success, so the update seemed to finish while OpenCode stayed on 1.19. When the installed OpenCode is a major release behind the latest one, Moxxy now runs `opencode upgrade --major`. This is OpenCode's own command, and it replaces version 1 with version 2 the way it was installed, so the computer does not end up with two `opencode` programs. New OpenCode installs on macOS and Linux use OpenCode 2's installer (`opencode.ai/v2/install`), because `opencode.ai/install` still installs OpenCode 1.
- 332e4c2: Collaborative mode is gone. The desktop no longer has a Collaborate tab, the terminal no longer has `/collab`, and the CLI no longer has the internal `moxxy collab` and `moxxy agent` commands. The `@moxxy/mode-collaborative` and `@moxxy/plugin-collab` packages are no longer bundled and were removed from the repo and from the install catalog. The `collab.*` desktop IPC commands and events and the `CollabRunSummary` type were removed, along with `CollaborationBlock` and its views in `@moxxy/chat-model`. Collaboration events in old saved runs are no longer shown.
- Updated dependencies [71f8aa8]
- Updated dependencies [db33b95]
- Updated dependencies [71e90e5]
- Updated dependencies [84ff880]
- Updated dependencies [b6c11c4]
- Updated dependencies [02119e8]
- Updated dependencies [29841af]
- Updated dependencies [211f80c]
- Updated dependencies [49dd789]
- Updated dependencies [90ab0bb]
- Updated dependencies [cb494ef]
- Updated dependencies [b6c11c4]
- Updated dependencies [887b8b7]
- Updated dependencies [072b8b5]
- Updated dependencies [a8e8418]
- Updated dependencies [322f2ce]
- Updated dependencies [7868760]
- Updated dependencies [4af5560]
- Updated dependencies [ee669b7]
- Updated dependencies [3c1527c]
- Updated dependencies [178a215]
- Updated dependencies [318d476]
- Updated dependencies [7cc93a2]
- Updated dependencies [6e54a6b]
- Updated dependencies [1329245]
- Updated dependencies [8472068]
- Updated dependencies [deeeeea]
- Updated dependencies [46b20d3]
- Updated dependencies [9bfe644]
- Updated dependencies [d2de3a1]
- Updated dependencies [7d718f6]
- Updated dependencies [6f4d652]
- Updated dependencies [d118b03]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0
