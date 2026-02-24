# Discord Notify

Send a message to a Discord channel. Supports targeting a specific channel by ID or using the first channel in the listen list as the default.

## Usage

**Send to a specific channel (preferred):**
```bash
discord_notify "<channel_id>" "Your message here"
```

**Send to the default channel (first in listen list):**
```bash
discord_notify "Your message here"
```

## Channel Targeting

When the user asks to send a message to a named channel (e.g. "#announcements"):

1. First call `discord_channels` to list available channels and find the channel ID.
2. Then call `discord_notify` with that channel ID and the message.

If no channel ID is provided, the message goes to the first channel in the agent's listen list.

## Listening Behaviour

The bot maintains a **list of listen channels** (`discord_listen_channels`):
- The bot **only** processes guild messages from channels in this list.
- When the list is empty, the bot ignores all guild messages (it stays idle until channels are added).
- DMs are always accepted regardless of the listen list.

A **listen mode** (`discord_listen_mode`) further narrows behaviour:
- `all` (default) – respond to every message in the listen channels.
- `mentions` – only respond when the bot is @mentioned in a listen channel.

Channels can be added or removed via:
- `POST /api/agents/{agent}/channels/discord/listen-channels` with `{ "channel_id": "123456789" }`
- `POST /api/agents/{agent}/channels/discord/listen-channels/remove` with `{ "channel_id": "123456789" }`
- The web dashboard Channels panel.

## Notes
- Discord must already be configured for the current agent.
- Use `discord_channels` to discover available channel IDs by name.
- The bot always *replies* in the channel where it received a message. The listen list controls which channels the bot pays attention to.
