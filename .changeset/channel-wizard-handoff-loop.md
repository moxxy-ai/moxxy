---
'@moxxy/cli': patch
---

Fix the channel setup wizard's "Start the bot" re-opening the same menu forever on a TTY (Discord, Telegram, WhatsApp, …): the wizard hand-off now marks itself so the channel starts instead of routing back into setup.
