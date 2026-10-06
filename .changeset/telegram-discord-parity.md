---
"@moxxy/cli": minor
"@moxxy/desktop": minor
---

Telegram works like the Discord bot: it keeps a model of its own (`/model` buttons, or Channels → Telegram → Setup in the desktop) that no longer changes the desktop's or TUI's model, `/auto-approve` is the same switch as Auto-approve in the desktop's chat with the bot, a message written in the app shows in Telegram with its reply, `telegram_send_message` sends files you ask for (up to 50 MB), a voice message is answered with a voice message, and the bot can run in the background from Channels → Telegram → Run mode. Telegram bots cannot take or place calls, so `/call` points to voice messages.
