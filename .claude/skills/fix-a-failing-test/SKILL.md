---
name: fix-a-failing-test
description: Locate, run, and filter a single failing vitest suite or test — use when a test fails and you need the fastest reproduce loop.
---

# Fix a failing test

Tests are colocated: `packages/<pkg>/src/*.test.ts`, run by vitest per package.

```sh
pnpm --filter @moxxy/sdk test                  # one package's whole suite
pnpm --filter @moxxy/sdk test stuck-loop       # only files matching "stuck-loop"
pnpm --filter @moxxy/sdk test -t "repeats"     # only test TITLES matching
pnpm --filter @moxxy/sdk exec vitest run src/stuck-loop.test.ts  # exact file
```

Gotchas:
- Do **NOT** insert `--` before vitest flags (`pnpm ... test -- -t x` silently
  drops the filter and runs everything). pnpm forwards args as-is.
- `-t` matches test titles, positional args match file paths. "138 skipped,
  0 passed" means your `-t` pattern matched nothing.
- Root `pnpm test` additionally runs `pnpm test:scripts`
  (`node --test scripts/*.test.mjs` — safe-publish helpers).

Provider-shaped tests use `@moxxy/testing`:
- `FakeProvider` for scripted turns; record/replay harness keyed by
  `MOXXY_FIXTURES` = `replay` (default) | `record` | `passthrough`.
- "Fixture missing" error → re-run that suite with `MOXXY_FIXTURES=record`
  and a real key, commit the fixture.

Conventions:
- Network/port tests bind port 0 (ephemeral) — never a fixed port (EADDRINUSE
  flake, fixed in PR #123). Follow that in new tests.
- Desktop self-update suite: `pnpm --filter @moxxy/desktop-host test app-update`.
- If a fix touches a package without tests for that path, add one — audit
  waves repeatedly found zero-coverage regressions (see TECH_DEBT.md).
