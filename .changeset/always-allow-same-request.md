---
'@moxxy/sdk': minor
'@moxxy/core': patch
'@moxxy/runner': patch
'@moxxy/cli': patch
'@moxxy/desktop-host': patch
'@moxxy/desktop': patch
'@moxxy/plugin-channel-mobile': patch
'@moxxy/plugin-telegram': patch
'@moxxy/plugin-channel-discord': patch
---

"Always allow" on a request for access to an app now saves just that request: full access to Safari is let through later, also in a new conversation, but a request for Terminal or for more control still asks. Before, the answer was saved for the whole tool and every later request passed unasked. Within the conversation the answer covers the same request only, and Telegram and Discord now keep "Allow session" to the same request too for such a tool.

For tool authors: the permission file takes `inputEquals` (exact values per input field), the SDK adds `alwaysAllowRule` and `createSessionGrants`, and runner protocol 32 carries `inputEquals` in `permission.addAllow` (a client never sends it to an older runner).
