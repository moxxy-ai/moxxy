---
name: add-a-tool
description: Add one model-callable tool to a plugin (schema, permission, handler, test) — use when the agent needs a new capability.
---

# Add a tool

Full discipline + anatomy: **`.claude/agents/tool-author.md`**. Checklist:

```ts
import { defineTool, z } from '@moxxy/sdk';
export const myTool = defineTool({
  name: 'my_tool',
  description: 'One sentence, verb first — the model reads this.',
  inputSchema: z.object({ ... }),       // strict; no z.any()/z.unknown() at top level
  permission: { action: 'prompt' },     // allow | deny | prompt — side effects ⇒ prompt
  handler: async (input, ctx) => { ... },
});
```

Rules that have bitten before:
- **Respect `ctx.signal`** (abort) and **use `ctx.cwd`**, never `process.cwd()`.
- **Never put secrets in tool inputs/outputs** — they transit the model's
  context and persist in session logs. Take a vault key NAME and resolve via
  `ctx.getSecret` (audit A6), or write secrets to a 0600 file and return the
  path (A15). `${vault:NAME}` placeholders resolve at use time (A43).
- **Don't bypass the permission engine** — no ad-hoc "is this safe" checks in
  handlers; gating happens in dispatchToolCall + PermissionEngine + resolver.
- Long output: clamp/truncate while streaming, don't buffer unboundedly (A17).
- Subprocesses: spawn detached + signal the whole process group on
  timeout/abort, SIGTERM → grace → SIGKILL (A16, `tools-builtin/src/bash.ts`).

Wire it: add to the owning plugin's `definePlugin({ tools: [...] })`. New
tool family with no home → new plugin (add-a-plugin skill).

Test: colocated `*.test.ts`; call the handler directly with a fake ctx, plus
one schema-rejects-bad-input case. Then `pnpm build` + changeset.
