---
'@moxxy/cli': patch
'@moxxy/desktop': patch
'@moxxy/sdk': minor
---

The browser costs far fewer tokens on large pages. A page read has a size limit and says what it left out; a list that empties reports one line instead of every row that went; `browser_find` looks words up on the page and returns only the matching rows (a matching label brings its field); a run of steps ends with a short read; and once a tab is read whole again, its earlier reads are sent as a one-line marker that `recall` can expand (a new `supersede` contract in `@moxxy/sdk` any tool result can use). `web_fetch` can wait for a service that was just deployed to come up (`untilUpMs`) instead of reporting it broken while it starts.
