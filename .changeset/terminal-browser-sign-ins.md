---
'@moxxy/cli': patch
---

The browser the agent uses in the terminal can be signed in to sites. It keeps a profile in `~/.moxxy/browser/profile`, so a sign-in lasts from run to run: `moxxy browser login <site>` opens a window to sign in and keeps what the site stored once you close it, `moxxy browser logout <site>` forgets one site (`--all` forgets every sign-in), and `moxxy browser sites` lists them. The same actions are `/browser` in the TUI. One browser uses the profile at a time; a second run starts signed out and says so.
