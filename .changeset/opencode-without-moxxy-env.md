---
'@moxxy/plugin-provider-acp': patch
---

OpenCode no longer keeps Moxxy's internal settings after Moxxy quits. OpenCode 2 runs one shared server in the background, which stays after Moxxy quits and is used by every OpenCode you open later, in a terminal too. When Moxxy started it, that server kept Moxxy's variables, such as the browser bridge token and `ELECTRON_RUN_AS_NODE`, and passed them to the commands OpenCode ran. Moxxy now starts every OpenCode command without them, including the sign-in and model checks, which are what start that server.
