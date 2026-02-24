# Discord Notify

Send a message to a Discord channel. Supports targeting a specific channel by ID or using the default paired channel.

## Usage

**Send to a specific channel (preferred):**
```bash
discord_notify "<channel_id>" "Your message here"
```

**Send to the default paired channel:**
```bash
discord_notify "Your message here"
```

## Channel Targeting

When the user asks to send a message to a named channel (e.g. "#announcements"):

1. First call `discord_channels` to list available channels and find the channel ID.
2. Then call `discord_notify` with that channel ID and the message.

If no channel ID is provided, the message goes to the default paired channel:
- **Auto-detected**: The first time someone messages the bot in a Discord channel, that channel ID is stored.
- **Explicitly pinned**: Via `POST /api/agents/{agent}/channels/discord/channel` with `{ "channel_id": "123456789" }`.

## Notes
- Discord must already be configured for the current agent.
- Use `discord_channels` to discover available channel IDs by name.
- The bot always *replies* in the channel where it received a message, regardless of the pinned channel. The pinned channel only affects proactive `discord_notify` messages.
