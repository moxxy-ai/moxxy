---
'@moxxy/cli': patch
'@moxxy/plugin-browser': patch
---

Wait for Chromium's next render frame before reporting viewport dimensions and overflow after a resize or reset. Report an unconfirmed layout if the frame does not arrive, rather than returning stale dimensions as a success.
