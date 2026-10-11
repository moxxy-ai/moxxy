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
- `session` records the agent's own session id; the next turn gets it back as `req.resumeSessionId`. `req.sessionId` is the Moxxy conversation, the key for keeping one live agent per conversation.
- `auto_approve` reports the agent's real approval policy, which becomes the conversation's auto-approve (one state); `req.autoApprove` carries it into the next turn.
- Everything the agent needs from Moxxy goes through `req.host`: `runTool` for a Moxxy tool it called over MCP (hooks, permissions and log as usual), `approve` before it runs a tool of its own (`policyOnly` for a hook that must not ask the person), `ask` for its Question.
- `goal` reports the agent's own goal (Claude `/goal`, Codex `thread/goal`): `active` or `complete`. It is recorded as a `goal_status` plugin event, and goal mode ends its run on `complete` through `onAgentGoal` instead of waiting for `goal_complete`.
- `plan` hands over the agent's finished plan (Codex plan mode). Plan mode shows it in its plan card through `onAgentPlan` and ends the run; a mode without the hook shows it as the agent's message. An agent whose plan arrives inside an approval (Claude `ExitPlanMode`) uses `host.approve` instead.
- `stream` still serves one-shot text calls (skill synthesis, summaries).
- Moxxy's end-of-turn reminders do not run on these turns; a checkpoint runs there only with `agentConnections: true`.

The parts every agent connection needs live in `@moxxy/agent-connection-kit` (published, because the connection plugins install from npm on demand; add it to `CLOSURE` in `apps/desktop/scripts/bundle-plugins-seed.mjs` too):

- `startMoxxyMcpServer` — the MCP server (Streamable HTTP on 127.0.0.1, bearer token, browsers refused) through which the agent calls Moxxy tools. Point it at a turn with `setHandler(moxxyToolsHandler(req.tools, req.host))`, and at `undefined` between turns. Results go through `toolOutputForModel` from `@moxxy/sdk`, so the agent sees exactly what a model would (images as pixels).
- `JsonRpcLineClient` — JSON-RPC over stdio lines, with or without the `"jsonrpc"` field (Codex app-server leaves it out, ACP agents send it); both sides can make requests.
- `AgentSessionPool` — one live agent per conversation up to a limit, the idlest closed first, waiting on turn ends (never a timer); close the conversation's agent from `onShutdown` (`pool.close(String(ctx.sessionId))`).
- `agentModeFor` — Moxxy mode to the agent's own `default` / `plan` / `goal`.
- `Inbox` / `untilStopped` — a queue of the agent's notifications for the turn reader (wakes on `push`, never polls), and a wait that ends on Stop.
- `transcript` — a one-off request's messages as one prompt, for `stream`.
- `inspectAgentCli` — the CLI's version, who installed it (npm, Homebrew, the vendor installer) and the matching update command.

`FakeAgentProvider` (`@moxxy/testing`) scripts `agentStep` for tests of modes and surfaces. To test a connection itself, replace only the vendor boundary and drive it through a real Moxxy session, as `plugin-provider-claude-code` does with `fake-claude.testkit.ts` and `plugin-provider-codex-agent` with `fake-codex.testkit.ts` (a fake `codex app-server` over streams, which calls Moxxy tools through the real MCP server).

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
