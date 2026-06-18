---
"@moxxy/desktop-host": patch
"@moxxy/desktop": patch
---

fix(desktop): stop the `moxxy-app://` scheme registration from crashing hot-updates (0.10 → 0.8 downgrade)

The Apps feature registered its `moxxy-app://` privileged scheme with a
top-level `protocol.registerSchemesAsPrivileged` call in the hot-updatable
`index.ts`. Electron only honors that API **before** `app` is ready, but the
immutable bootstrap loads the real main via `import()` **after** `whenReady` —
so every hot-updated bundle threw `"protocol.registerSchemesAsPrivileged should
be called before app is ready"` on load, got poisoned, and reverted to the baked
floor. Observed live as a 0.10.0 → 0.8.x downgrade.

- Register the privileged scheme in the bootstrap's synchronous pre-ready
  prologue (the one place guaranteed to run before ready); the privileges are
  single-sourced in a new `app-scheme` module so the bootstrap and `index.ts`
  can't disagree. The call in `index.ts` is now a defensive no-op post-ready, so
  a new override no longer crashes even on an already-installed older bootstrap.
- Pruning after staging now also keeps the last `confirmed` bundle — the exact
  rollback target `recoverFromFailedBoot` needs — so a genuinely failed boot
  rolls back to the last-good override instead of falling all the way to the
  floor.
