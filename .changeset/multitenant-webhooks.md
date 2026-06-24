---
"@moxxy/cli": minor
---

Make webhook deliveries multi-tenant across concurrent runner processes, and auto-restore the proxy tunnel on boot.

The webhook listener binds a single shared port, so with several runners (the desktop runs one `moxxy serve` per workspace) ONE runner received every delivery and fired it on **its own** session — a webhook created in workspace A's chat would fire in whatever workspace happened to win the port, or not reach A at all. And the proxy tunnel only ever lived in memory, so after a restart the saved public URL pointed at nothing (GitHub showed "We couldn't deliver this payload: timed out").

Now:

- Webhook triggers carry an optional `ownerSessionId`; `webhook_create` stamps it with the creating runner's `MOXXY_SESSION_ID`.
- The runner that owns the listener routes each verified, filtered delivery: a trigger owned by **another** runner is handed off via a shared on-disk queue (`~/.moxxy/webhooks/queue/`); owner-less or own triggers fire in-process as before.
- Every runner runs a drain poller that fires the queued deliveries addressed to **its** session — so the digest lands in the workspace that created the webhook. Deliveries for an offline workspace wait durably until it returns (with a 7-day stale sweep).
- The runner that wins the listener bind **re-opens the proxy tunnel on boot** when the saved public URL came from the proxy, so "the app is running" once again means "the webhook URL is reachable." Only that one runner restores it, so the N runners don't collide on the single keypair-derived relay subdomain.

Single-process CLI/TUI behavior is unchanged (no `MOXXY_SESSION_ID` → every delivery fires in-process, no queue/drain).
