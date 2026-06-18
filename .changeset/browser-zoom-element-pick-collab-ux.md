---
"@moxxy/plugin-browser": patch
"@moxxy/desktop": patch
---

feat(surfaces): browser zoom + "select element for the agent"; redesigned Collaborate start

**Browser zoom.** ⌘+ / ⌘− / ⌘0 (and toolbar buttons) zoom the page in the
in-window browser (CSS `zoom` via a new sidecar `zoom` method), intercepted so
they zoom the page rather than the whole desktop app.

**Select an element for the agent.** A new "select element" toggle lets you click
any element on the page; the sidecar's `pick` method resolves a best-effort CSS
selector + text snippet, and a bar appears where you describe a change ("make it
blue") and hit **Ask agent** — which tasks the session (`session.runTurn`) to
change that element via the browser tool. Aimed at the localhost dev loop
("change this XXX to YYY").

**Collaborate tab.** Redesigned the "Start a collaboration" empty state: a proper
composer card (focus ring, ⌘↵ to start, primary action) plus quick-start example
chips, replacing the bare input + button.
