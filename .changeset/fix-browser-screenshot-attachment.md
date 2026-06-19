---
"@moxxy/desktop": patch
---

fix(desktop): send pasted / dropped / browser-capture images to the model

Images that arrive as bytes — a clipboard paste, a drag-drop, or a
browser-surface screenshot — are stashed to a temp file under `os.tmpdir()` and
then ride the same attachment pipeline as a picked file. But `session.runTurn`'s
provenance gate (`authorizeAttachments`) only trusts paths the native picker
handed out or paths inside the workspace cwd, and `session.saveImageAttachment`
— unlike `session.pickAttachment` — never remembered the temp path it wrote. So
every byte-sourced image was silently dropped at send time (only a `console.warn`
in the main process) and the prompt reached the model as text only. This was a
regression: the provenance gate, added in the PR right after the chat
image-paste feature, never vouched for the paste/capture path.

`session.saveImageAttachment` now remembers the temp path it creates, mirroring
`session.pickAttachment`, so pasted / dropped / captured images survive the gate
and actually reach the model.
