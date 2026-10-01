---
'@moxxy/cli': patch
---

Computer Use on macOS: four failures found by repeated trials are fixed. A control that accepts an accessibility press and does nothing (Qt buttons, as in CapCut's export dialog) gets a real click when the model asks again. Finder's rename field, which sits outside the window, is now part of the app state, and typing into an element that takes no text is refused instead of being lost. A browser page is read only after its content has loaded, and the model is told when it has not. Looking at an app again between actions no longer trips the stuck-loop guard. The guidance tells the model to send several actions in one response.
