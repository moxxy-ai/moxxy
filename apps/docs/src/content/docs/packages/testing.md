---
title: '@moxxy/testing'
description: FakeProvider, record/replay fixtures, session helpers.
---

`@moxxy/testing` is the test harness for moxxy itself and for plugin
authors. Three building blocks:

- **`FakeProvider`** — scripted replies, no network.
- **Record/replay fixtures** — wrap a real provider; record once, replay forever.
- **Session helpers** — a pre-built session for tests that don't care about wiring.

## Install

```sh
pnpm add -D @moxxy/testing
```

## FakeProvider

A `FakeProvider` plays back scripted replies in order (or keyed by
request hash via `byHash`). Each reply is an array of `ProviderEvent`s;
the `textReply` / `toolUseReply` helpers build the common shapes:

```ts
import { FakeProvider, textReply, toolUseReply } from '@moxxy/testing';

const provider = new FakeProvider({
  script: [
    toolUseReply('Read', { file_path: 'a.ts' }),
    textReply('done.'),
  ],
});
```

`streamingTextReply(chunks)` builds a reply that emits one
`text_delta` per chunk, for testing chunk-level handling.
`provider.received` collects every `ProviderRequest` for assertions;
`provider.reset()` rewinds the script.

## Record / replay

```ts
import { RecordedProvider, fixtureMode } from '@moxxy/testing';

const provider = new RecordedProvider({
  upstream: realProvider,
  fixtureDir: './fixtures',
  mode: fixtureMode(), // reads MOXXY_FIXTURES: 'record' | 'replay' | 'passthrough'
});
```

`MOXXY_FIXTURES=record` writes a deterministic JSON file per request
(keyed by `hashRequest`). `replay` (the default) reads from disk and
fails loudly when a fixture is missing; `passthrough` forwards to the
upstream provider unchanged.

## Session helpers

```ts
import { createFakeSession, FakeProvider, textReply } from '@moxxy/testing';

const session = createFakeSession({
  provider: new FakeProvider({ script: [textReply('ok')] }),
  // plugins: [...] // extra plugins beyond the provider shim
});
```

`createFakeSession` wires the provider into a real `Session` with an
auto-allow permission resolver and a silent logger — no vault, no
plugin discovery, no provider auth. Useful when the test only cares
about the loop / hook / channel under test.

## Exports

- `FakeProvider`, `FakeProviderOptions`, `ScriptedReply`, `ScriptedReplies`
- `textReply`, `toolUseReply`, `streamingTextReply`
- `RecordedProvider`, `RecordedProviderOptions`, `fixtureMode`, `FixtureMode`
- `createFakeSession`, `FakeSessionOptions`
- `hashRequest(req)` — the fixture key function
