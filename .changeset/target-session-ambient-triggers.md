---
"@moxxy/sdk": minor
"@moxxy/plugin-webhooks": minor
"@moxxy/plugin-scheduler": minor
"@moxxy/plugin-workflows": minor
"@moxxy/desktop-ipc-contract": minor
"@moxxy/client-core": minor
"@moxxy/desktop": minor
"@moxxy/core": patch
"@moxxy/workflows-builder": patch
"@moxxy/desktop-host": patch
"@moxxy/plugin-channel-mobile": patch
"@moxxy/cli": patch
---

feat: pick which session ambient triggers run in + a compact trigger marker

Ambient triggers (webhooks, schedules, workflows) used to fire on whichever
session **created** them, and the synthesized prompt — often a large block
carrying an untrusted webhook payload — rendered as a giant user bubble. Two
changes:

**Pick the target session.** Each trigger can now be pinned to a chosen session
(where its run executes *and* displays), decoupled from who created it:

- `webhook_create` / `schedule_create` take an optional `targetSessionId`
  (defaulting to the creating session), and `webhook_update` /
  `schedule_set_target` reassign it. These map onto the existing
  `ownerSessionId` routing key, so the webhook queue/drain and the scheduler
  owner-gate already deliver to the right runner — no routing change.
- Workflows gained a top-level `targetSessionId`. Scheduled workflows stamp it
  onto their scheduler mirror row (reusing the owner-gate); `fileChanged` is
  watched only by the target runner; a cross-session `afterWorkflow` dependent
  is skipped with a warning (the completion event is in-process to the parent's
  runner). The visual builder preserves the field across a round-trip.
- Desktop: the Webhooks / Schedules / Workflows panels and the workflow builder
  gain a session picker (new `*.setTargetSession` IPC commands), and each
  summary surfaces the resolved target-session name.

**Compact trigger marker.** A fired trigger now renders as a one-line,
expandable chip ("Webhook received · github-issues", "Schedule fired · daily",
"Workflow ran · digest") instead of the raw prompt — click to reveal the full
payload. The prompt still lives in the model's context (security fences intact);
only the display changes (new optional `origin` on the `user_prompt` event,
threaded from the fired turn via `RunTurnOptions.origin`).

Unset everywhere preserves today's behavior; single-process CLI/TUI is
unaffected.
