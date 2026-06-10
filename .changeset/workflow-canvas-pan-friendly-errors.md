---
'@moxxy/plugin-workflows': patch
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Workflow builder UX: the canvas pans by dragging the background (grab cursor; node drag / connection drag / click-to-deselect unaffected), the header controls (Back / validity badge / Save) align to the name/description input row instead of floating centred, and schema validation errors read as plain English anchored to the step — `step "greet": prompt must not be empty` instead of `steps.0.prompt: String must contain at least 1 character(s)` — so the builder can pin them to the offending node card.
