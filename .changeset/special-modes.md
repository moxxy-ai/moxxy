---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

Add a generic "special mode" mechanism. `ModeDef.special` (a `ModeSpecial` descriptor, optionally `{ invokedBy }`) marks a mode that is entered only via its own invocation — never offered in a mode list and never name-switched from `/mode`. Special modes are filtered uniformly via the new `isSelectableMode` predicate across every surface: `SessionInfo.modes` (mobile/desktop), the TUI `/mode` picker + by-name switch (which now points the user at `/<invokedBy>`), and the `/plugins` swap axis. The collaborative modes (`collaborative`, `collab-architect`, `collab-peer`) opt in — they're a separate system launched by `/collab` (TUI) or the desktop CollaboratePanel, not a pickable mode. Extensible: future special modes set the same flag.
