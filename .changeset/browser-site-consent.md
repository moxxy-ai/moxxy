---
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Desktop browser: allow a site once instead of approving every action. The new `browser_allow_site` asks for a site for the rest of the conversation; clicks, typing, keys, navigation and the other acting tools no longer prompt per call, and the desktop refuses any of them that would land on a site the conversation has not allowed. Approvals live in the session log, so every client sees the same sites; dialogs and `browser_session` still ask every time, and the terminal UI is unchanged.
