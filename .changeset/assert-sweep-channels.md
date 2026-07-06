---
'@moxxy/plugin-channel-discord': patch
'@moxxy/plugin-channel-signal': patch
'@moxxy/plugin-channel-slack': patch
'@moxxy/plugin-channel-whatsapp': patch
'@moxxy/plugin-telegram': patch
---

Replace non-null assertions (`x!`) and deep optional chains (`a?.b?.c`) in the
channel plugins with guard clauses. Source sites that are impossible-by-construction
now assert loudly via `assertDefined`/`invariant` from `@moxxy/sdk` instead of
silently propagating `undefined`; inbound-message silent-drop gates are preserved
exactly. No behavior change on the success path.
