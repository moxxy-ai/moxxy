---
'@moxxy/plugin-provider-acp': patch
---

Moxxy no longer leaves OpenCode's shared background server running after you quit it. OpenCode 2 starts that server for commands such as its sign-in and model checks, and it stays until you stop it. When the server already runs, Moxxy's checks still use it. When it does not, they now run on a private server that ends with each check, which makes a check about a second slower.
