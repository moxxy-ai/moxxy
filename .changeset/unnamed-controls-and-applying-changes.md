---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A button with no name is read with what its markup says (`button (no name; markup: @click="modalOpen=false")`), so the agent no longer takes a close button for the action beside it. The browser skill says a change the page reports as not applied yet is not done: the agent uses the control that does it under another name (a restart that reloads the settings) when it touches only what the task set up, and asks first otherwise.
