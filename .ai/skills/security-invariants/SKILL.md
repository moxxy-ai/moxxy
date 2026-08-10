---
name: security-invariants
description: The load-bearing security invariants every change must preserve (trust boundaries, secrets, kill-safety, URL schemes) — use when reviewing or writing any code that crosses a trust boundary.
---

# Security invariants (do not regress these)

These rules are self-contained; preserve them even when the implementation
around them changes.

1. **Zod at every trust boundary.** Renderer→main IPC
   (`desktop-ipc-contract/validation.ts`), inbound WS frames, webhook
   bodies, persisted JSON read back from disk (corrupt file ≠ empty file —
   quarantine, don't clobber). Compile-time types protect nothing at
   runtime.
2. **Never kill by port without identity.** Verify the holder's `ps` command
   line carries a moxxy marker before TERM/KILL; otherwise fall back to an
   ephemeral port. The CLI sets `process.title = 'moxxy …'` to make this
   work.
3. **Vault name, not plaintext.** Secrets never transit model-visible tool
   args/results or session logs: tools take a vault KEY NAME, MCP/env configs
   carry `${vault:NAME}` resolved at connect/use time, and generated secrets
   go to 0600 files with a masked preview returned.
4. **Scheme allow-list for agent-authored URLs.** `isSafeViewUrl` (sdk):
   https/http/mailto/tel + relative; `data:image/*` for img src only —
   enforced at parse AND render. Outbound fetches:
   `assertPublicUrl` + DNS-pinned dispatcher so check and connect can't
   diverge (SSRF/rebinding); update sources are HTTPS + host
   allow-listed.
5. **Capability-detect, don't crash.** Remote/thin sessions expose optional
   `SessionLike` members (`reset?`, `mcpAdmin?`, …) — feature-detect and
   degrade; never cast a RemoteSession to the concrete Session.
6. **Auto-approve still consults policy.** Prompt-free `policyCheck` runs
   user deny rules in unattended modes (goal, webhooks) — auto-approve skips
   the PROMPT, never the policy. And never bypass the permission
   engine with ad-hoc handler checks.
7. **Gate every session-reaching path behind auth/pairing** — including
   secondary handlers like inline-button callbacks and browser-Origin
   upgrades (default-deny).
8. **Signed bytes are verified bytes.** Self-update verifies the signed
   per-file hash map at stage time AND every load; don't add code paths
   that execute staged content before verification.

Smell test for new code: "what happens if the JSON/peer/renderer/model is
malicious?" — if the answer is "it can't be", prove it with the validator.
