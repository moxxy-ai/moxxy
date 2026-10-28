---
'@moxxy/sdk': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop': patch
---

Quitting the app stops what its agents started. A dev server an agent started detached (`(nohup npx vite &)`) kept answering on localhost after Cmd+Q: it leaves the runner's process tree at once, so nothing stopped it. The app now stops each runner together with every process below it (`stopProcessTree`), and on quitting (or removing a workspace) also every process that still carries the runner's `MOXXY_RUNNER_SOCKET` in its environment (`killProcessesWithEnv`), both in `@moxxy/sdk/server`. A new chat restarts the runner but leaves such a detached dev server running.
