---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

When the agent hands the desktop's browser to you — to sign in, enter a code or choose on a cookie banner — it waits the ten minutes the pane gives you. The call to the pane was cut at two and a half minutes like any other, so the agent read "browser bridge call timed out" while you were still signing in.
