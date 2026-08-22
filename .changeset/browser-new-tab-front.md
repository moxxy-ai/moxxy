---
'@moxxy/desktop': patch
---

Opening a tab goes to it, the way every browser does.

A new tab appeared in the strip and the pane stayed on the old one, so pressing
plus looked like nothing had happened and a tab the agent opened was somewhere
you had to go find.

A view is registered exactly when someone opened a tab — the person pressed plus,
or the agent asked for one — so that is the moment to move to it. It moves what
the person sees and nothing else: where the agent is working is tracked apart
from the tab in front, which is the same separation that stops a click in the
strip from re-aiming the agent mid-task.
