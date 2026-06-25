---
name: run-the-gate
description: Run the full pre-PR verification gate (build/typecheck/lint/test/deps) with turbo caching — use before reporting any code change done or opening a PR.
---

# Run the gate

Always from the repo root — the root scripts go through `turbo run`, which gives
graph ordering + caching. `pnpm -r <task>` bypasses the cache; don't use it.

```sh
pnpm build        # turbo run build   — MUST be green before reporting done
pnpm typecheck    # turbo run typecheck
pnpm lint         # eslint . (root, no turbo; warnings ok, errors fail)
pnpm test         # turbo run test && node --test scripts/*.test.mjs
pnpm check:deps   # dependency-cruiser invariants (sdk has no internal deps, core never imports plugins, no cycles)
```

All exit non-zero on failure. CI (`.github/workflows/ci.yml`) runs exactly these
plus two smokes on Node 20/22/24:

```sh
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js plugins list
```

Gotchas:
- **Rebuild before reporting done.** The CLI binary is tsup-bundled — source
  edits don't reach `packages/cli/dist/bin.js` until `pnpm build`. "Tests pass"
  is not "the app works".
- Tests run provider calls from recorded fixtures (`MOXXY_FIXTURES=replay` is
  the default; CI sets it explicitly). Never need an API key.
- Warm turbo cache makes unchanged packages instant (~seconds for the whole
  repo); first run in a fresh worktree is minutes.
- A Stop hook already runs `pnpm -w typecheck` on dirty worktrees
  (`.claude/hooks/gate-on-stop.sh`) — that is a backstop, not the gate.
- CI also requires a changeset on every PR — see the add-a-changeset skill.
