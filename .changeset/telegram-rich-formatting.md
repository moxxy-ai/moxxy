---
"@moxxy/plugin-telegram": minor
---

Richer, tidier Telegram messages with first-class use of Telegram's formatting.

- **Collapsible tool trace.** The per-turn tool-activity block stays open and
  live while the agent works, then folds into an expandable `🔧 N steps`
  blockquote on the final message — the reply leads with the answer and the
  step-by-step detail is one tap away.
- **Detail-hiding Markdown extensions** the model can opt into: `~~strike~~`
  (`<s>`), `||spoiler||` (`<tg-spoiler>`), and GitHub/Obsidian-style callout
  boxes via `> [!type] Title`. A trailing `-` starts the box collapsed
  (`> [!details]- Raw logs`), `+` forces it open; `details`/`example`/`faq`
  collapse by default. A long plain `>` quote auto-collapses too.
- The message splitter now closes/reopens `<blockquote expandable>` and
  hyphenated Telegram tags (`<tg-spoiler>`) across the 4096-char cut, so split
  messages stay valid HTML.
- `telegram_send_message` (used by scheduled/one-off pushes) now renders its
  text with the same Markdown→Telegram formatting by default, with a plain-text
  fallback; pass an explicit `parseMode` to opt out and send verbatim.
