---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Computer Use on macOS now has a live picture-in-picture view in the desktop chat. While the agent works in an app, a small view above the composer shows that window at about two frames a second, with the agent's cursor drawn on top. The picture is for the person only: it travels over the surface channel, is never sent to the model, and is never written to the session log. The helper captures only while someone is watching and stops when the turn ends or the user presses Stop. The view can be hidden for one conversation or for all of them, and brought back from the control strip.
