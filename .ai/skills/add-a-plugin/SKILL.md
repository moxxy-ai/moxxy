---
name: add-a-plugin
description: Create a new @moxxy/plugin-* package (workspace or user-scope) and wire it for discovery — use when adding any new plugin to moxxy.
---

# Add a plugin

Full workflow with scaffold templates: **`.claude/agents/plugin-author.md`** —
read it; this skill is the wiring checklist.

User-scope (no workspace edits): `moxxy plugins new <name>` →
`~/.moxxy/plugins/<name>/`, then `moxxy plugins reload`.

Workspace plugin — `packages/plugin-<thing>/`:

1. `package.json`: name `@moxxy/plugin-<thing>`, `"private": true`,
   `"type": "module"`, manifest `"moxxy": { "plugin": { "entry": "./src/index.ts" } }`,
   dep on `@moxxy/sdk` (`workspace:*`). Runtime deps (e.g. `zod`) go in
   `dependencies`, NOT devDependencies — audit items A20/A21 were exactly that
   bug.
2. `src/index.ts`: `definePlugin({ name, tools, providers, channels,
   compactors, cacheStrategies, isolators, commands, hooks, skillsDir, ... })`.
3. Register: add the package to `packages/cli/package.json` dependencies AND
   import/instantiate it in `packages/cli/src/setup/builtins.ts` (in-repo
   plugins are statically registered there; tsup auto-bundles every workspace
   dep into the binary — only sdk/zod/keyring/playwright/transformers stay
   external, see `packages/cli/tsup.config.ts`).
4. `pnpm check:deps` — invariants: plugins MAY import `@moxxy/core` only if
   they're channels; loop-runtime plugins (modes/compactors/providers) must
   not. Core never imports a plugin — pass services via closure
   (`buildXPlugin(deps)` pattern, see `buildSynthesizeSkillPlugin`).
5. Lifecycle hooks must be WIRED, not just declared (`onEvent` needs the
   subscribe→dispatch wiring; `onShutdown` needs `Session.close()`).
6. Gate + changeset (`@moxxy/cli` patch/minor — plugins ship inside it).

Make new cross-cutting strategies registry-backed swappable blocks (mirror
CompactorRegistry), not hardcoded behavior.
