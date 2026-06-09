---
name: security-invariants
description: The load-bearing security invariants every change must preserve (trust boundaries, secrets, kill-safety, URL schemes) — use when reviewing or writing any code that crosses a trust boundary.
---

# Security invariants (do not regress these)

Each was a confirmed audit finding once. Citations = TECH_DEBT.md A-items.

1. **Zod at every trust boundary.** Renderer→main IPC
   (`desktop-ipc-contract/validation.ts`), inbound WS frames (A8), webhook
   bodies, persisted JSON read back from disk (corrupt file ≠ empty file —
   quarantine, don't clobber, A14). Compile-time types protect nothing at
   runtime.
2. **Never kill by port without identity.** Verify the holder's `ps` command
   line carries a moxxy marker before TERM/KILL; otherwise fall back to an
   ephemeral port (A7). The CLI sets `process.title = 'moxxy …'` to make this
   work.
3. **Vault name, not plaintext.** Secrets never transit model-visible tool
   args/results or session logs: tools take a vault KEY NAME (A6), MCP/env
   configs carry `${vault:NAME}` resolved at connect/use time (A43),
   generated secrets go to 0600 files with a masked preview returned (A15).
4. **Scheme allow-list for agent-authored URLs.** `isSafeViewUrl` (sdk):
   https/http/mailto/tel + relative; `data:image/*` for img src only —
   enforced at parse AND render (A44). Outbound fetches:
   `assertPublicUrl` + DNS-pinned dispatcher so check and connect can't
   diverge (SSRF/rebinding, A45); update sources are HTTPS + host
   allow-listed.
5. **Capability-detect, don't crash.** Remote/thin sessions expose optional
   `SessionLike` members (`reset?`, `mcpAdmin?`, …) — feature-detect and
   degrade; never cast a RemoteSession to the concrete Session.
6. **Auto-approve still consults policy.** Prompt-free `policyCheck` runs
   user deny rules in unattended modes (goal, webhooks) — auto-approve skips
   the PROMPT, never the policy (A3, A4). And never bypass the permission
   engine with ad-hoc handler checks.
7. **Gate every session-reaching path behind auth/pairing** — including
   secondary handlers like inline-button callbacks (A46) and browser-Origin
   upgrades (default-deny, A27).
8. **Signed bytes are verified bytes.** Self-update verifies the signed
   per-file hash map at stage time AND every load (A2); don't add code paths
   that execute staged content before verification.

Smell test for new code: "what happens if the JSON/peer/renderer/model is
malicious?" — if the answer is "it can't be", prove it with the validator.
