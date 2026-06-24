---
"@moxxy/desktop-ipc-contract": minor
"@moxxy/client-core": minor
"@moxxy/desktop-host": minor
"@moxxy/desktop": minor
---

Desktop: declutter the composer toolbar and turn Apps into the ambient-automation hub.

**Composer toolbar**
- **Mode** moves into the `+` overflow as a disclosure submenu (`Mode: default ▸` → the mode list, active one checked), so it no longer takes a top-level chip.
- **Model** moves to the right of the toolbar as a quiet, borderless label (the active model name, provider as fallback) instead of a chip button. Clicking it opens a combined **Model & context** panel — the provider/model picker on top, the context-window usage + one-click compaction below — replacing the separate model chip and context meter.

**Top navigation + Apps**
- The top-level switcher is now **Chat · Collaborate · Apps** — the separate **Actions** tab is gone; its Workflows / Schedules / Webhooks grouping moves into Apps.
- The **Apps** view keeps the installable-app gallery as its landing and gains a right-aligned sub-nav: **Workflows · Schedules · Webhooks**. Each chip swaps the body to that surface; re-clicking the active chip returns to the gallery.
  - Workflows / Schedules reuse the existing embedded panels.
  - **Webhooks** is upgraded from the previous stage-1 placeholder (which only listed webhook-triggered workflows) to a real panel backed by new host-only `webhooks.list` / `webhooks.setEnabled` / `webhooks.delete` IPC, which read the shared webhooks store directly (so triggers created from chat appear) with verification secrets redacted at the boundary.
