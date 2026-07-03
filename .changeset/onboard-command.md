---
"@moxxy/cli": minor
"@moxxy/sdk": minor
"@moxxy/plugin-plugins-admin": patch
"@moxxy/plugin-telegram": patch
"@moxxy/plugin-channel-slack": patch
"@moxxy/plugin-channel-discord": patch
"@moxxy/plugin-channel-signal": patch
"@moxxy/plugin-channel-whatsapp": patch
---

`moxxy onboard` — one guided command from a fresh install to a paired, always-on agent: provider wizard (skipped when configured) → messenger pick from the install catalog → version-pinned install + `moxxy.setup` fields → the channel's own pairing in a new pair-then-return mode (`EXIT_AFTER_PAIR_FLAG` in the SDK, honored by all five pair flows) → a `moxxy serve --all` background unit. Also: channel install hints are now derived from catalog `provides` (telegram/slack/web/http entries gained theirs), Telegram + Slack declare `moxxy.setup` token steps, the `service` catalog's serve unit actually starts channels (`--all`, matching its description), and service units survive Electron-as-node installs (`ELECTRON_RUN_AS_NODE=1` exported into the unit).
