---
name: provider-author
description: Implement an LLMProvider for a new model API.
---

# Provider author — implement an `LLMProvider`

A provider is an adapter from the moxxy `ProviderRequest`/`ProviderEvent` types to a vendor API. The SDK contract:

```ts
interface LLMProvider {
  readonly name: string;
  readonly models: ReadonlyArray<ModelDescriptor>;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
  countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number>;
}
```

## Use the SDK's shared utilities

```ts
import {
  isRetryableError,    // identical retry heuristic across providers (rate_limit / 429 / network)
  zodToJsonSchema,     // zod → JSON schema for the vendor tool spec
  type StopReason,     // 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'error'
} from '@moxxy/sdk';
```

These were duplicated across `plugin-provider-anthropic` and `-openai` until they were hoisted. Reuse them so a new provider stays consistent.

## `stream` translation

The yielded events are the SDK's `ProviderEvent` discriminated union:

- `message_start` — at the start of the assistant turn
- `text_delta` — for each chunk of text
- `tool_use_start` / `tool_use_delta` / `tool_use_end` — for tool calls (input JSON is streamed)
- `message_end` — `{ stopReason, usage? }`
- `error` — `{ message, retryable }`

Use `@moxxy/plugin-provider-anthropic` as the reference. For each vendor:

1. Translate `ProviderMessage[]` → vendor message shape (system hoists to top-level for Anthropic; inline for OpenAI).
2. Translate `tools: ToolDef[]` → vendor function-call schema via `zodToJsonSchema(tool.inputSchema)`.
3. Iterate the vendor's stream and yield moxxy `ProviderEvent`s. **Track parallel tool_use blocks by their `index` field**, not by "first key in the pending map" — that bug shipped once and misrouted deltas (see the index→id mapping in `provider-anthropic/src/provider.ts`).
4. Map vendor stop reasons to `StopReason`.
5. Wrap your try blocks so `isRetryableError(err)` informs the `error` event's `retryable` flag.

## Abort signal

Pass `req.signal` to the vendor SDK's abort plumbing if it supports it (Anthropic's `messages.stream` and OpenAI's `chat.completions.create` both honor `AbortSignal`). Otherwise check `req.signal.aborted` between yields and `return` — but also call the vendor stream's `.abort()` / `.controller.abort()` if available, to free the socket.

## Validate keys

Implement `validateKey?` on the `ProviderDef` so `moxxy doctor --check-keys` and `moxxy init` can ping the API cheaply (e.g. `messages.create({max_tokens: 1})` for Anthropic, `models.list()` for OpenAI). Return `ProviderKeyValidation = { ok: true } | { ok: false, message: string }`.

```ts
export const myProviderDef = defineProvider({
  name: 'my-vendor',
  models,
  createClient: (cfg) => new MyProvider(cfg),
  validateKey: async (key) => {
    try {
      await new VendorSDK({ apiKey: key }).ping();
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  },
});
```

The CLI's `validateProviderKey()` is a thin registry dispatcher — it has zero knowledge of provider internals.

## Permission flow is upstream

The provider never sees permission logic. It only emits `tool_use_start`/`tool_use_end`. The loop strategy gates on the result.

## Agent connections (`agentStep`)

A provider that runs a vendor's own coding agent (Claude, Codex, OpenCode) instead of calling a model adds `agentStep(req): AsyncIterable<AgentStepEvent>` (types in `@moxxy/sdk`, `agent-step.ts`). The shared loop (`runReactLoop`) then hands each round of the conversation to it and records what it yields as ordinary events, so every mode and every surface keeps working:

- `text_delta` / `message` become `assistant_chunk` / `assistant_message`; `tool_call` / `tool_result` become `tool_call_requested` (with `executedBy: 'provider'`) / `tool_result`; `usage` lands on `provider_response`.
- A file the agent creates or edits shows as a diff when its `tool_result` output is a `ToolDisplayResult` (`{ forModel: <the agent's text>, display }`). Build the `display` with `fileDiffFromPatch` (patch hunks, e.g. from `parseUnifiedDiff`) or `fileDiffFromText` (text before and after), and give the path with `diffPathIn(cwd, file)`; all from `@moxxy/sdk`.
- The images the agent's tool returned show under the tool's line when the output is `imageToolOutput(text, images)` from `@moxxy/sdk` (every image, in order; it keeps one copy of an image sent twice); `toolImagesOf(output)` reads them back.
- `session` records the agent's own session id; the next turn gets it back as `req.resumeSessionId`. `req.sessionId` is the Moxxy conversation, the key for keeping one live agent per conversation.
- `auto_approve` reports the agent's real approval policy, which becomes the conversation's auto-approve (one state); `req.autoApprove` carries it into the next turn.
  Report it only while `req.autoApproveRecorded` is false: once the conversation recorded a switch, `req.autoApprove` wins over the agent's own setup. A connection that can read that setup without starting the agent implements `ProviderDef.ownAutoApprove({ cwd })` (Claude: its settings via the SDK's `resolveSettings`; Codex: `config/read` on a short-lived `codex app-server`; OpenCode: `opencode debug agent build`), so the switch is the truth before the first message. `req.autoApproveFromAgent` says the switch in force is that own setup, not the person's choice.
  An agent whose asking is set only by its own rules (OpenCode) reads them first and reports `auto_approve` on when they ask for nothing; when the person turns it off, the agent is restarted once with those rules made to ask for that process only (OpenCode: `OPENCODE_CONFIG_CONTENT`), never by editing its config. What the agent's own setting still asks the person about (OpenCode: work outside the project) goes to `approve` with `askPerson` while auto-approve is the one Moxxy turned on, so the person answers it although auto-approve is on.
- Everything the agent needs from Moxxy goes through `req.host`: `runTool` for a Moxxy tool it called over MCP (hooks, permissions and log as usual), `approve` before it runs a tool of its own (`policyOnly` for a hook that must not ask the person), `ask` for its Question.
- `goal` reports the agent's own goal (Claude `/goal`, Codex `thread/goal`): `active` or `complete`. It is recorded as a `goal_status` plugin event, and goal mode ends its run on `complete` through `onAgentGoal` instead of waiting for `goal_complete`.
- `plan` hands over the agent's finished plan (Codex plan mode). Plan mode shows it in its plan card through `onAgentPlan` and ends the run; a mode without the hook shows it as the agent's message. An agent whose plan arrives inside an approval (Claude `ExitPlanMode`) uses `host.approve` instead.
- `agentOwns: { plan, goal }` on the provider says which of the two the agent keeps itself (Claude and Codex: both). An agent without them (OpenCode) is steered by Moxxy's plan and goal modes like any model: lend it `plan_complete` / `goal_complete` / `goal_abandon` over MCP, and the modes' nudges ("submit the plan through `plan_complete`", "keep going or call `goal_complete`") arrive as its next message when it stops without one. A round in which the agent ran tools, its own or Moxxy's, counts as work, not idling.
- `req.fast` is the person's fast mode: run the agent on its own faster tier where it has one (Codex `serviceTier: 'priority'`), and back on the person's own setting when it is off.
- An approval answer that carries no reason (Codex's bare `decline`, ACP's `reject_once`) still owes the agent the person's reason: Codex gets it through `turn/steer` in the running turn, or in its next message; an ACP agent, which ends its turn on a refusal, gets it as its next prompt in the same Moxxy turn (a few times at most, then with the person's next message).
- `stream` still serves one-shot text calls (skill synthesis, summaries).
- Moxxy's end-of-turn reminders do not run on these turns; a checkpoint runs there only with `agentConnections: true`.

The parts every agent connection needs live in `@moxxy/agent-connection-kit` (published, because the connection plugins install from npm on demand; add it to `CLOSURE` in `apps/desktop/scripts/bundle-plugins-seed.mjs` too):

- `startMoxxyMcpServer` — the MCP server (Streamable HTTP on 127.0.0.1, bearer token, browsers refused) through which the agent calls Moxxy tools. Agents read the tool list once, when their session opens, so list every tool of the conversation, the same in every mode: `req.allTools` (`req.tools` is only what this turn's mode offers). The loop refuses, with the reason and in the log, a call to one the mode does not offer, so the handler passes every call to `req.host.runTool`. Set `setHandler(idleToolsHandler(all))` before the agent starts (it lists the tools and runs none), `setHandler(moxxyToolsHandler(all, req.host))` for a turn, and the idle handler again after it. When the list changes (`sameToolNames` says whether it did), an agent that honours `notifications/tools/list_changed` (Claude, OpenCode) is told through `announceTools()` after `setHandler` and before the prompt, which waits until it read the list again; one that does not (Codex) gets a new process that resumes the same thread. Results go through `toolOutputForModel` from `@moxxy/sdk`, so the agent sees exactly what a model would (images as pixels).
- `JsonRpcLineClient` — JSON-RPC over stdio lines, with or without the `"jsonrpc"` field (Codex app-server leaves it out, ACP agents send it); both sides can make requests.
- `resumeAgentSession` — load the agent's earlier session for a conversation. A fresh session only ever answers `gone` (the agent says the session no longer exists); any other failure is tried once more and then thrown, so a passing fault never silently drops the history. Never `.catch(() => undefined)` a resume into a new session.
- `earlierConversationNote(reason, req.earlierConversation?.())` — whenever the adapter starts a new agent session (`'lost'` after `gone`, `'new'` when there was nothing to resume), put this note before the first message the session gets. `earlierConversation` is Moxxy's record of the turns so far (latest turns verbatim, a line per older turn, within ~16k tokens); it is `undefined` on a conversation's first turn, so a new conversation gets nothing extra. Lend `recall` over MCP (do not list it among the agent's own tools): it searches the whole conversation and reads any turn, which the agent's own memory cannot once its session is gone.
- `AgentSessionPool` — one live agent per conversation up to a limit, the idlest closed first, waiting on turn ends (never a timer); close the conversation's agent from `onShutdown` (`pool.close(String(ctx.sessionId))`).
- `agentModeFor` — Moxxy mode to the agent's own `default` / `plan` / `goal`.
- `Inbox` / `untilStopped` — a queue of the agent's notifications for the turn reader (wakes on `push`, never polls), and a wait that ends on Stop.
- `transcript` — a one-off request's messages as one prompt, for `stream`.
- `inspectAgentCli` — the CLI's version, who installed it (npm, Homebrew, the vendor installer) and the matching update command.

`FakeAgentProvider` (`@moxxy/testing`) scripts `agentStep` for tests of modes and surfaces. To test a connection itself, replace only the vendor boundary and drive it through a real Moxxy session, as `plugin-provider-claude-code` does with `fake-claude.testkit.ts` `plugin-provider-codex-agent` with `fake-codex.testkit.ts` (a fake `codex app-server` over streams, which calls Moxxy tools through the real MCP server), and `plugin-provider-acp` with `fake-opencode.testkit.ts` (a fake `opencode acp`).

## Recorded fixtures

Use `RecordedProvider` from `@moxxy/testing` to record real API calls into JSONL fixtures, then replay deterministically in CI:

```ts
const recorder = new RecordedProvider({
  mode: process.env.MOXXY_FIXTURES === 'record' ? 'record' : 'replay',
  upstream: new MyProvider({ apiKey: process.env.MY_KEY }),
  fixtureDir: path.join(__dirname, '__fixtures__'),
  testName: 'my-feature',
});
```

CI runs in `replay` (default) — no tokens consumed. Re-record with `MOXXY_FIXTURES=record`.

## `countTokens`

Prefer the vendor's native counter (`client.messages.countTokens` for Anthropic, `tiktoken` for OpenAI). For testing, the heuristic `chars / 4` is acceptable. Used by the compactor to decide when to summarize.

## Ship as a plugin

```ts
import { defineProvider, definePlugin } from '@moxxy/sdk';
import { MyProvider } from './provider.js';

export const myProviderDef = defineProvider({
  name: 'my-vendor',
  models: [/* { id, contextWindow, maxOutputTokens, supportsTools, supportsStreaming } */],
  createClient: (config) => new MyProvider(config as MyConfig),
  validateKey: (key) => validateMyKey(key),
});

export default definePlugin({
  name: '@moxxy/plugin-provider-my-vendor',
  providers: [myProviderDef],
});
```

The CLI's `moxxy init` reads `session.providers.list()` to populate the SetupWizard — adding a provider plugin auto-appears.

## Don't

- **Don't reimplement `isRetryableError` / `zodToJsonSchema`.** Use the SDK helpers.
- **Don't return the first map key when routing streamed tool-use deltas.** Use the event's `index` to disambiguate parallel blocks.
- **Don't swallow errors.** Yield an `error` event with `retryable: isRetryableError(err)` so the loop can back off.
- **Don't tie the provider to a transport assumption.** `LLMProvider` only requires `stream()` and `countTokens()` — vendors can talk HTTP, gRPC, local model, recorded fixtures.
