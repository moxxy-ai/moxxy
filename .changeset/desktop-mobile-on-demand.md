---
"@moxxy/desktop": patch
"@moxxy/desktop-ui": patch
---

Promote the mobile gateway to its own sidebar entry (above Settings) and make it on-demand only.

- Move the mobile pairing surface out of Settings into a dedicated top-level **Mobile** view in the sidebar.
- The gateway no longer auto-starts with the app — it stays off on every launch and is enabled explicitly per session (the persisted pairing token/identity are kept, so re-enabling reuses the same QR).
- Tear the gateway down through its manager on quit so the end-to-end proxy tunnel is closed and the relay deregisters this machine — fixing the "unresponsive until you regenerate the code" pairing left behind by a leaked tunnel from the previous run.
