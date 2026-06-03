---
"@moxxy/desktop": patch
---

Fix self-update never taking effect: the immutable bootstrap read
`app.getPath('userData')` before `app.setName('MoxxyAI Workspaces')` ran (that
call lives in the later-loaded `index.js`). In a packaged build Electron derives
`getName()` from the package `name` (`@moxxy/desktop`), not electron-builder's
`productName`, so the loader looked for staged updates under a different userData
directory than the one the updater writes to — making every downloaded update
invisible and silently booting the baked floor instead. The bootstrap now sets
the app name before resolving `userData`, so it and the updater agree. (Takes
effect after one fresh installer; subsequent hot-updates then apply.)
