# @moxxy/plugin-provider-acp

## 0.45.0

### Minor Changes

- d118b03: OpenCode agent connection: the new `opencode` provider (`@moxxy/plugin-provider-acp`, an Agent Client Protocol adapter with OpenCode as its first agent) hands each turn to OpenCode itself through `opencode acp`, with the person's own OpenCode setup, permission rules and models (the picker offers what `opencode models` lists). Moxxy shows what OpenCode does, answers its permission asks through the usual approval (by itself while auto-approve is on, standing deny rules still applying), shows its real approval state in auto-approve (on with OpenCode's defaults, which ask for nothing; turning it off restarts that conversation's OpenCode once with the person's rules made to ask, for that process only, denials kept), hands it the person's reason after a refusal, cancels its prompt on Stop, loads its session after a restart, and lends it Moxxy's tools over a local MCP server, which now tells an agent that read the tool list once (OpenCode reads it when its session opens) that a turn brought other tools; OpenCode's config is never edited. Providers now say through `agentOwns` whether their agent keeps its own plan and goal (Claude, Codex); for an agent without them, Moxxy's plan and goal modes lend `plan_complete` and the goal tools and nudge it like any model, and a round in which the agent ran its own tools counts as work.
- 2c3a14e: OpenCode's background helpers now show in Moxxy as Claude's and Codex's do. A subagent OpenCode starts with `background: true` is listed in the Agents pane and above the message box while it works, its steps show as they happen, Stop ends it, and when it finishes the turn OpenCode starts by itself to answer its result shows in the chat as "Agent continued". A helper the person stopped opens no such turn. A helper the turn waits for now shows its steps too. ACP reports none of this, so Moxxy starts `opencode acp` with background subagents on (unless the person set `OPENCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS` themselves) and with its HTTP API on a port Moxxy picked, behind a password only Moxxy knows, and reads OpenCode's event stream there. When OpenCode stops to wait for a used-up account limit (its free tier, its Go plan), the turn now ends with the "Limit" note instead of waiting, possibly for hours; OpenCode does not say how much of a limit is used, so nothing shows before that. The daily agent check now also starts OpenCode as Moxxy does and fails when its HTTP API stops asking for Moxxy's password or `task` stops offering to run in the background.

### Patch Changes

- 667a232: OpenCode 2's helpers show as helpers again. OpenCode 2 renamed its `task` tool to `subagent` and its `bash` tool to `shell`, so its helpers showed as a plain tool with OpenCode's instructions to the model as their result; now they show with their task, agent and answer, as OpenCode 1's do, and the helper's commands show as Bash. OpenCode 2's `acp` does not report what a helper started in the background does nor when it ends, and cannot stop it, so such a helper is closed at once with a note that it works on in the background; the live check records background work as not supported on OpenCode 2. OpenCode 1 is unchanged.
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
- Updated dependencies [436496c]
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
- Updated dependencies [d2de3a1]
- Updated dependencies [2160501]
- Updated dependencies [2b9c87f]
- Updated dependencies [332e4c2]
- Updated dependencies [a06de31]
- Updated dependencies [066a949]
- Updated dependencies [fa44b8c]
  - @moxxy/sdk@0.45.0
  - @moxxy/agent-connection-kit@0.1.0
