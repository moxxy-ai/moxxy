# @moxxy/plugin-provider-codex-agent

## 0.47.0

### Patch Changes

- Updated dependencies [53709f4]
- Updated dependencies [1e49040]
- Updated dependencies [5f83fb5]
- Updated dependencies [3879896]
- Updated dependencies [24bd7f3]
  - @moxxy/agent-connection-kit@0.1.2
  - @moxxy/sdk@0.47.0

## 0.46.0

### Patch Changes

- Updated dependencies [546836d]
  - @moxxy/sdk@0.46.0
  - @moxxy/agent-connection-kit@0.1.1

## 0.45.0

### Minor Changes

- 8472068: ChatGPT — Codex agent connection: the new `codex-agent` provider (`@moxxy/plugin-provider-codex-agent`) hands each turn to Codex itself through `codex app-server`, on the ChatGPT sign-in of the person's installed Codex CLI. Codex keeps its own instructions, config, tools, skills and MCP servers; Moxxy shows what it does and its approvals, turns its plan-mode questions into Moxxy questions and its plan into the plan card, runs goal mode through Codex's own thread goal (ending when Codex says it is met), and lends it Moxxy's tools over a local MCP server. Auto-approve gives only the current conversation's Codex full access; `~/.codex/config.toml` is never edited. The SDK adds a `plan` agent event and `onAgentPlan`, through which plan mode shows an agent's own plan in its card. `@moxxy/agent-connection-kit` gains `Inbox`, `untilStopped` and `transcript`. The `openai-codex` provider is now labelled "ChatGPT — Moxxy".

### Patch Changes

- 436496c: Agent connections can lend Moxxy's tools as a catalog of three small tools (`find_tools`, `describe_tools`, `call_tool`) instead of every tool one by one (`moxxyToolsHandler` / `idleToolsHandler` option `{ catalog: true }`). The catalog names the tool groups (an MCP server, or tools sharing a prefix such as `browser`), sorted so it reads the same however the tools were registered and the agent's prompt cache keeps matching; the agent looks a tool up and reads its input only when it wants it, and `call_tool` runs the real tool in the turn, so the chat shows that tool and never the catalog steps.

  ChatGPT — Codex agent: Moxxy's tools now reach Codex as that catalog. Lent one by one, their full descriptions went with every request Codex made, tens of thousands of tokens once the person's MCP servers were set up. Codex's own tools, skills and MCP servers are unchanged.

  Claude Agent: Moxxy's tools now reach Claude as that catalog too. Claude listed every one of them by name in each request, hundreds once the person's MCP servers were set up. Claude's own tools, skills and MCP servers are unchanged.

- deeeeea: ChatGPT — Codex agent: Moxxy's fast mode now runs the conversation's Codex on its fast tier (Codex's `/fast`, the `priority` service tier) and hands it back to the person's own setting when turned off; `agentStep` requests carry `fast`. When the person declines one of Codex's tools, their reason reaches Codex in its running turn (`turn/steer`), or in its next message when the turn can no longer take input, since Codex's approval answer has no room for it.
- aadafb4: ChatGPT — Codex agent: the conversation's Codex thread now opens (and resumes) on the model the person picked in Moxxy. It used to open on the model from the person's Codex config and switch before the first turn, so Codex sent its model-switch instructions (about 4,000 tokens) with every request of the conversation. A model picked later in the conversation still switches the thread as before.
- d2de3a1: A question the agent asks can no longer leave the conversation stuck.

  - A question Codex asks while it works is shown at once instead of when its turn ends. An answer given while Codex works goes into its running turn. When Codex finishes without the answer, the question closes with the note that Codex went on. When Codex ends its turn on the question (plan mode), it still waits for the answer as before.
  - A new message from the person closes any question an earlier turn still waits on, so that turn ends and the new message runs. A message an agent or a trigger started does not.
  - An open question stays on screen while any turn runs, not only while the turn that asked it runs.
  - The question card on Telegram and Discord says why a question closed: the agent went on, or a new message was sent.
  - Desktop and terminal history keep the reason a question closed without an answer. A new message interrupts a Codex turn blocked on native user input before that turn can keep waiting on an empty answer.
  - `@moxxy/sdk`: `QuestionAsker` callers can pass `{ signal }` to `ModeContext.ask` and `AgentStepHost.ask`; aborting it with `QUESTION_CLOSED_AGENT_WENT_ON` closes the question with that note. A dismissed `QuestionOutcome` and the `question_resolved` record carry an optional `note`. New exports: `QUESTION_CLOSED_AGENT_WENT_ON`, `QUESTION_CLOSED_NEW_MESSAGE`, `questionCloseNote`, `QuestionCloseNote`, `QuestionAskOptions`.

- 6f4d652: A new conversation no longer starts on the provider's biggest model when no default model is chosen. It starts on the provider's light starter model instead: Haiku 5.5 for Claude, GPT-6 Luna for Codex (both the agent connection and the ChatGPT sign-in). A default model chosen in Settings → Default model still comes first, and a conversation keeps the model it last ran on. Settings → Default model, the chat's effort and fast controls, a bot's "Default" model and the terminal's header now show the model that really runs, not the first one listed. The helper calls Moxxy makes by itself, outside the conversation, run on the starter model too instead of the biggest one: merging memories (`memory_consolidate`), drafting a workflow (`workflow_create`, unless the host sets a draft model) and the post-turn reflection.

  The SDK adds `LLMProvider.starterModel`, `ProviderDef.starterModel`, `ProviderInfo.starterModel` and `startingModel()`. The runner protocol goes to v30 (`ProviderInfo.starterModel`, additive); an older runner leaves it out and surfaces fall back to the first listed model.

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
