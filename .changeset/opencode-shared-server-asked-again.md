---
'@moxxy/plugin-provider-acp': patch
---

OpenCode 2 on a busy computer: when OpenCode's plugins take longer than the 5 seconds it allows them, Moxxy now asks OpenCode's shared server again, up to three times, until they are up. Before, a shared server it had just started timed out the same way and the check failed with "Location plugins did not finish activating".
