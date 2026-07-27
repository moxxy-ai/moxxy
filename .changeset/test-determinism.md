---
'@moxxy/cli': patch
---

Make three load-sensitive tests deterministic.

Each asserted wall-clock timing rather than behaviour, so a local `pnpm test` could not distinguish a regression from a busy machine.

`CrossProcessFireLock` used a 15 ms TTL with a real sleep: any scheduling pause between claiming the fresh marker and sweeping expired it too. It now sets file mtimes and passes the already-injectable clock, with no sleep at all.

The workflows "fires once across two concurrent runners" test raised its `vi.waitFor` budget to 20 s while vitest's default test timeout stayed 10 s, so the generous budget was dead code and the test died first. It now declares its own timeout.

`isolator-subprocess`'s cooperative-abort test asserted that the production 150 ms grace was enough for a child to be scheduled and flush. `abortGraceMs` is now injectable and the test passes a generous value, so it asserts the mechanism while the production default is unchanged.

A repo-wide scan found no other test whose internal wait budget exceeds its own timeout.
