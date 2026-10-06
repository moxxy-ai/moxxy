---
'@moxxy/sdk': minor
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

A tool can name the modes it is for (`modes` on `defineTool`); other modes do not offer it to the model. Goal mode's goal_complete/goal_abandon and the collaboration's collab_* tools are now offered only there — in a plain browser task the model took goal_abandon and gave the task up. New `toolsForMode` in the SDK. The browser skill says plainly that allowing a site is a step the agent takes, never a reason to stop.
