---
"@moxxy/workspaces-app": minor
---

Desktop: group Workflows, Schedules and Webhooks under a new top-level **Actions** tab.

The header's "Workflows" segment becomes "Actions", which opens a surface with
three sub-tabs:
- **Workflows** — the existing panel (run-now, enable/disable, generate, builder),
  rendered embedded under the shared Actions header.
- **Schedules** — a new view over the existing `scheduler.list` IPC: each job's
  cron / next-fire / last result, with enable·disable and delete.
- **Webhooks** — the workflows that fire on an `on.webhook` trigger, with
  enable·disable.

This is stage 1 of the Actions work. Cancelling a running workflow *run* (runId
tracking + `workflows.cancel`) and the webhooks endpoint backend (URLs + delivery
history) are separate follow-ups.
