---
name: cache-strategy-author
description: Build a new prompt-cache strategy (CacheStrategy) and plug it in.
---

# Cache-strategy author — implement a `CacheStrategy`

A cache strategy decides **where** prompt-cache breakpoints go for one provider call and returns provider-neutral `CacheHint`s. The provider decides **how** to express them (Anthropic → `cache_control`; providers without caching ignore them). One strategy is active per session, registered via plugins — exactly like compactors and modes.

The SDK contract (`@moxxy/sdk`):

```ts
interface CacheStrategyDef {
  readonly name: string;
  plan(
    messages: ReadonlyArray<ProviderMessage>,
    ctx: CacheStrategyContext,
  ): ReadonlyArray<CacheHint>;
}

interface CacheStrategyContext {
  readonly model: string;
  readonly contextWindow: number;
  readonly log: EventLogReader;
  /** Index of the last message in the stable, cacheable prefix (or undefined). */
  readonly stablePrefixMessageIndex?: number;
}

// A hint targets the tools array, the system prompt, or a message boundary:
type CacheHint = { target: 'tools' | 'system' | { messageIndex: number } };
```

`@moxxy/cache-strategy-stable-prefix` is the reference: static breakpoints at `tools` + `system`, an optional long-lived breakpoint at the stable-prefix boundary, and a rolling breakpoint at the last message.

## **Determinism is the whole game**

`plan` MUST be a pure, deterministic function of its inputs. Prompt caching only pays off when the cached prefix is **byte-identical** across the inner iterations of a turn. A breakpoint whose position wobbles (depends on wall-clock time, RNG, map iteration order, …) shifts the prefix between calls so every read misses — and you pay the **1.25x cache-write tax for 0 reads**, strictly worse than no caching. The `/usage` panel flags this as "cache ineffective."

```ts
plan(messages, ctx) {
  const hints: CacheHint[] = [{ target: 'tools' }, { target: 'system' }];
  const lastIdx = lastNonSystemIndex(messages);
  if (lastIdx < 0) return hints; // nothing but a system prompt yet

  // Long-lived breakpoint at the stable boundary, only when it's strictly
  // before the tail (otherwise the rolling breakpoint already covers it).
  const stableIdx = ctx.stablePrefixMessageIndex;
  if (stableIdx != null && stableIdx >= 0 && stableIdx < lastIdx) {
    hints.push({ target: { messageIndex: stableIdx } });
  }

  hints.push({ target: { messageIndex: lastIdx } }); // rolling tail
  return hints;
}
```

## Placing breakpoints

- **Stack the static-most prefixes first.** `tools` (fixed for the whole session) then `system` (fixed given a stable skill set) cache the largest, longest-lived spans.
- **Use `ctx.stablePrefixMessageIndex` for the cross-turn breakpoint.** The mode reports the elision/compaction boundary — everything at or before it is stable across turns, so a breakpoint there survives turn-to-turn. It's `undefined` when no boundary is computable; fall back to a conservative placement (just the static + rolling breakpoints).
- **Always add a rolling tail breakpoint** at the last message so each inner iteration reads everything prior from cache and only pays full price for its own new delta.
- **Respect the provider cap.** Anthropic allows **at most 4** breakpoints; emit `≤ 4` (return fewer when there's nothing to gain). Don't assume non-Anthropic providers honor any — hints are advisory.
- **Index into the `messages` array you were handed**, not the event log. `messageIndex` is positional in `plan`'s argument.

## Ship as a plugin

```ts
import { defineCacheStrategy, definePlugin } from '@moxxy/sdk';

const myStrategy = defineCacheStrategy({ name: 'my-strategy', plan });

export default definePlugin({
  name: '@moxxy/cache-strategy-<name>',
  cacheStrategies: [myStrategy],
});
```

Declare the manifest kind in `package.json`:

```json
{ "moxxy": { "plugin": { "entry": "./dist/index.js", "kind": "cache-strategy" } } }
```

Activate via `session.cacheStrategies.setActive('my-strategy')`. **The first strategy registered auto-activates** (CacheStrategyRegistry mirrors CompactorRegistry), so order matters: ship your default first and an opt-out `none` (a strategy whose `plan` returns `[]`) second, the way the stable-prefix plugin does.

## Tests

Mirror `@moxxy/cache-strategy-stable-prefix`'s test file: build a `messages` array + a fake `CacheStrategyContext`, call `plan`, and assert the exact hints. Cover the correctness-critical cases:

- **Determinism** — calling `plan` twice on identical inputs returns identical hints.
- **Stable boundary** — given `stablePrefixMessageIndex`, the cross-turn breakpoint lands there; when it's undefined or ≥ the tail, it's omitted.
- **Cap** — never returns more than 4 hints.
- **Degenerate input** — a system-prompt-only message list returns just the static hints (no message breakpoints).

## Don't

- **Don't let breakpoints depend on anything outside `messages` + `ctx`.** Time, randomness, external mutable state — all defeat the cache.
- **Don't exceed the provider breakpoint cap.** Extra hints are dropped unpredictably and can shift which prefix gets cached.
- **Don't place a breakpoint past the last message or inside the rolling delta** — you'd cache content that changes every iteration and never hit.
- **Don't express provider specifics here.** Return neutral `CacheHint`s; translating to `cache_control` (or ignoring them) is the provider's job.
```
