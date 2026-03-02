# Channels

Channels connect agents to external messaging platforms like Telegram and Discord. Users can chat with agents through their preferred messaging app.

## Concepts

- **Channel**: A configured messaging bridge (Telegram bot or Discord bot)
- **Binding**: Links a specific chat/conversation to an agent
- **Pairing Code**: A 6-digit code used to securely bind a chat to an agent

## Pairing Workflow

```
1. Create a channel (register bot token)
   POST /v1/channels

2. User sends /start in Telegram/Discord
   Bot generates a 6-digit pairing code

3. Pair the chat to an agent
   POST /v1/channels/{id}/pair
   with code + agent_id

4. Messages flow:
   User message in chat -> agent run -> response in chat
```

## Endpoints

### Create Channel

```
POST /v1/channels
```

**Required scope**: `channels:write`

**Request body**:

```json
{
  "channel_type": "telegram",
  "display_name": "My Support Bot",
  "bot_token": "123456:ABC-DEF...",
  "config": {}
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel_type` | string | Yes | `telegram` or `discord` |
| `display_name` | string | Yes | Human-readable name |
| `bot_token` | string | Yes | Bot API token (stored in vault) |
| `config` | object | No | Additional channel configuration |

**Response** (201 Created):

```json
{
  "id": "019cac17-...",
  "channel_type": "telegram",
  "display_name": "My Support Bot",
  "status": "active",
  "created_at": "2026-03-02T12:00:00Z"
}
```

The bot token is stored securely in the vault, not in the database.

### List Channels

```
GET /v1/channels
```

**Required scope**: `channels:read`

### Get Channel

```
GET /v1/channels/{id}
```

**Required scope**: `channels:read`

### Delete Channel

```
DELETE /v1/channels/{id}
```

**Required scope**: `channels:write`

### Pair Chat

```
POST /v1/channels/{id}/pair
```

**Required scope**: `channels:write`

**Request body**:

```json
{
  "code": "123456",
  "agent_id": "019cac12-..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `code` | string | Yes | 6-digit pairing code from `/start` command |
| `agent_id` | string | Yes | Agent to bind the chat to |

### List Bindings

```
GET /v1/channels/{id}/bindings
```

**Required scope**: `channels:read`

### Unbind Chat

```
DELETE /v1/channels/{id}/bindings/{binding_id}
```

**Required scope**: `channels:write`

Removes the binding between a chat and an agent. Messages from that chat will no longer trigger agent runs.

## Channel Architecture

The `moxxy-channel` crate provides the transport layer:

```
External Platform        Moxxy
+-----------+      +-------------------+
| Telegram  | <--> | TelegramTransport |
| Bot API   |      +-------------------+
+-----------+              |
                           v
                    +--------------+
                    | ChannelBridge|  Routes messages
                    +--------------+  between transports
                           |          and agents
+-----------+      +-------------------+
| Discord   | <--> | DiscordTransport  |
| Bot API   |      +-------------------+
+-----------+
```

The `ChannelTransport` trait defines:
- Sending messages (outgoing)
- Receiving messages (incoming)

The `ChannelBridge` routes incoming messages to the bound agent and sends agent responses back through the channel.

## Events

| Event | When |
|-------|------|
| `channel.message_received` | Inbound message from external chat |
| `channel.message_sent` | Outbound message to external chat |
| `channel.error` | Transport error (connection failure, API error) |

## Database Tables

| Table | Purpose |
|-------|---------|
| `channels` | Channel configurations |
| `channel_bindings` | Chat-to-agent mappings |
| `channel_pairing_codes` | Temporary pairing codes (with expiration) |

## CLI Usage

```bash
# Create a channel (interactive wizard)
moxxy channel create

# List channels
moxxy channel list

# Pair a chat
moxxy channel pair --code 123456 --agent <agent-id>

# List bindings
moxxy channel bindings <channel-id>

# Unbind a chat
moxxy channel unbind <channel-id> <binding-id>

# Delete a channel
moxxy channel delete <channel-id>
```
