---
name: provider-author
description: Implement an LLMProvider for a new model API.
---

# Provider author — implement an `LLMProvider`

A provider is an adapter from the moxxy `ProviderRequest`/`ProviderEvent` types to a vendor API. The contract is in `@moxxy/sdk`:

```ts
interface LLMProvider {
  name: string;
  models: ReadonlyArray<ModelDescriptor>;
  stream(req: ProviderRequest): AsyncIterable<ProviderEvent>;
  countTokens(req: Pick<ProviderRequest, 'model' | 'messages' | 'system' | 'tools'>): Promise<number>;
}
```

## `stream` translation

The yielded events are the SDK's `ProviderEvent` discriminated union:

- `message_start` — at the start of the assistant turn
- `text_delta` — for each chunk of text the assistant produces
- `tool_use_start` / `tool_use_delta` / `tool_use_end` — for tool calls (input JSON is streamed)
- `message_end` — with `stopReason` (`end_turn` | `tool_use` | `max_tokens` | `stop_sequence` | `error`)
- `error` — with `retryable: boolean`

Use `@moxxy/plugin-provider-anthropic` as the reference. Most APIs need:

1. Translate `ProviderMessage[]` to vendor message shape (system messages hoist to a top-level field for Anthropic; for OpenAI, they stay inline).
2. Translate `tools: ToolDef[]` to the vendor's function-call schema. The tool's `inputSchema` is a zod schema — convert to JSON Schema if the vendor needs it.
3. Iterate the SDK's stream events and yield corresponding moxxy `ProviderEvent`s.
4. Map vendor stop reasons to the moxxy union.

## Permission flow is upstream

The provider never sees permission logic. It only emits `tool_use_start`/`tool_use_end`. The loop strategy gates on the result.

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

Prefer the vendor's native token counter (`client.messages.countTokens` for Anthropic, `tiktoken` for OpenAI). For testing, the heuristic `chars / 4` is acceptable. Used by the compactor to decide when to summarize.

## Ship as a plugin

```ts
import { defineProvider, definePlugin } from '@moxxy/sdk';
import { MyProvider } from './provider.js';

export default definePlugin({
  name: '@moxxy/plugin-provider-<vendor>',
  providers: [
    defineProvider({
      name: '<vendor>',
      models: [/* descriptors with id, contextWindow, supportsTools, supportsStreaming */],
      createClient: (config) => new MyProvider(config),
    }),
  ],
});
```

Set as active via `session.providers.setActive('<vendor>', config)`.
