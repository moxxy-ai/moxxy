---
"@moxxy/sdk": minor
"@moxxy/cli": patch
---

Add a generic `createJsonFileStore` block to `@moxxy/sdk` capturing the repeated
whole-file JSON id-collection skeleton (in-memory cache + per-instance write
mutex + read-modify-write `.slice()` copy + crash-atomic `writeFileAtomic`),
with parsing/validation and corruption policy supplied by the caller's `load`
hook so each store keeps its exact on-disk format and error handling.

Migrate the scheduler and webhooks stores onto it (behavior unchanged: same
`{ version: 1, … }` pretty-printed format, same silent-reset vs.
preserve-aside/quarantine corruption policy, same 0600 quarantine sidecar). Fix
the workflows run-store's non-unique `${file}.tmp` write by routing it through
the shared `writeFileAtomic` (pid+uuid temp → no concurrent-writer collision,
no orphan temp on failure).

The vault store (encrypted, passphrase-keyed, 0600) and the provider-admin
store (name-keyed, versionless, trailing-newline format) are intentionally left
on their existing — already invariant-compliant — `createMutex` +
`writeFileAtomic` since they are not id-collections.
