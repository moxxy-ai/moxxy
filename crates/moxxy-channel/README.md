# moxxy-channel

Channel bridge system connecting Moxxy agents to external chat platforms.

## Overview

Routes messages between agents and chat platforms (Telegram, Discord). Handles transport-level communication, pairing/authentication, agent binding, and platform-specific formatting.

## Components

| Export | Description |
|---|---|
| `ChannelTransport` | Trait for chat platform implementations (receive, send, edit, typing) |
| `TelegramTransport` | Full Telegram Bot API implementation (long-polling, HTML formatting) |
| `DiscordTransport` | Placeholder (not yet implemented) |
| `ChannelBridge` | Central orchestrator -- routes messages, manages transports, handles commands |
| `PairingService` | 6-digit pairing codes with 5-minute TTL for binding channels to agents |
| `CommandRegistry` | Pluggable slash command framework for in-chat commands |

## Message Flow

```
External Chat (Telegram/Discord)
  -> Transport.start_receiving() (long-poll)
  -> ChannelBridge.handle_incoming()
  -> Command? -> CommandRegistry -> response
  -> Message? -> EventBus "channel.message_received"
                 -> Agent processes via RunStarter
                 -> Agent response via EventBus
                 -> Transport.send_message()
  -> External Chat
```

## Built-in Commands

`/start` (pairing), `/status`, `/stop`, `/new` (reset session), `/help`, `/model`, `/vault`

## Telegram Features

- Long-polling via `getUpdates` API
- Markdown-to-HTML conversion (bold, italic, code, links, headings)
- Message editing for progress updates
- Typing indicators
- Webhook cleanup to prevent polling conflicts

## Dependencies

- `moxxy-core` -- EventBus, ChannelStore, BindingEntry
- `moxxy-storage` -- Database access for channels and bindings
- `moxxy-vault` -- Secret backend for bot tokens
- `reqwest` -- HTTP client for platform APIs
