---
"@moxxy/cli": patch
---

Remove the two `npm install` deprecation warnings (`prebuild-install`, `boolean`) and slim the default install.

`@moxxy/cli` no longer installs heavy native optional dependencies by default:

- **keytar → `@napi-rs/keyring`**: keytar pulls the deprecated `prebuild-install`; `@napi-rs/keyring` ships per-platform NAPI prebuilds with no install scripts. OS-keychain unlock for the vault is preserved (it still falls back to the disk key / passphrase when the native binary is unavailable).
- **`@huggingface/transformers` and `playwright` are now install-on-demand** (dropped from `optionalDependencies`). Both were already loaded via guarded dynamic `import()`; the local-embeddings and browser features degrade gracefully and prompt to install when first used. This is what pulled `boolean` (via `onnxruntime-node` → `global-agent`).

Net effect: `npx @moxxy/cli` installs only `@moxxy/sdk`, `zod`, and `@napi-rs/keyring` — no deprecation warnings, smaller and faster.
