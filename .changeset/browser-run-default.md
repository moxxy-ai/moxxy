---
'@moxxy/cli': patch
'@moxxy/desktop': patch
---

Desktop browser: with Jev on, `browser_run` is now the default way to act on a page, even for one click, and it no longer reads the page first when the agent already knows what is on it. An `expect` is checked against what the action reported and against what appeared and went away on the page, so an alert, a banner closing or a new tab now counts as seen. A step delivered whose `expect` Jev could not confirm is reported as unverified rather than failed, so the agent checks the page instead of doing the step again. Fields a step's kind does not use are dropped before the run. The browser skill now tells the agent to finish the task itself and to compare every item in a list before answering. The browser trial harness logs every press and key a page gets, so a take-over during a run can be traced to its cause.
