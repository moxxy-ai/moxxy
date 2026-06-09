---
'@moxxy/plugin-oauth': patch
'@moxxy/plugin-vault': patch
'@moxxy/plugin-provider-claude-code': patch
'@moxxy/plugin-provider-openai-codex': patch
---

Serialize OAuth refreshes of single-use rotating refresh tokens (claude-code, openai-codex) and stop the vault from clobbering other writers. Refresh+persist now runs under a per-credential lock (new `withCredentialLock` in plugin-oauth: in-process mutex + best-effort O_EXCL lockfile with stale takeover under `<moxxy home>/locks`), so concurrent consumers — a second stream, the whisper-stt transcriber, or another moxxy process — coalesce into ONE IdP call and adopt the winner's rotated tokens instead of burning them; an invalid_grant after a concurrent rotation re-reads the vault and retries once with the fresher refresh token before declaring re-auth needed (CodexProvider gains a `reloadTokens` hook for this). `VaultStore` no longer persists a whole-file in-memory snapshot (last-writer-wins): every read/mutation folds the on-disk file back in (mtime-gated, newer-`updatedAt`-wins per key) before the atomic rename, so two processes writing different keys both survive.
