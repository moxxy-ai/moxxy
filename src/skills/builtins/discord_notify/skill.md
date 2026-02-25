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
- **`discord_add_listen_channel "<channel_id>"`** – add a channel to the listen list (preferred; use this when the user asks to add a channel).
- **`discord_remove_listen_channel "<channel_id>"`** – remove a channel from the listen list.
- The web dashboard Channels panel.

**Important:** Do NOT use `manage_vault` to modify `discord_listen_channels` – that overwrites the entire list. Always use the skills above.

## Setup

To configure Discord for the current agent, store the bot token in the vault under the key **`discord_token`**:

```bash
manage_vault set discord_token "<your-bot-token>"
```

The key **must** be exactly `discord_token` — any other name (e.g. `discord_bot_token`) will not be recognised by the runtime.

After saving the token, the gateway must be restarted for the bot to connect.

## Notes
- Use `discord_channels` to discover available channel IDs by name.
- The bot always *replies* in the channel where it received a message. The listen list controls which channels the bot pays attention to.
