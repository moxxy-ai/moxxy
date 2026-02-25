# Discord Add Listen Channel

Add a Discord channel to the bot's listen list. The bot will then process messages from this channel (subject to listen_mode).

## Usage

```bash
discord_add_listen_channel "<channel_id>"
```

## Workflow

When the user asks you to add a Discord channel for the bot to listen to:

1. Call `discord_channels` (no arguments) to get the list of available channels.
2. Find the channel ID for the requested channel (by name or guild).
3. Call `discord_add_listen_channel "<channel_id>"`.

## Notes

- **Do NOT use manage_vault** to modify `discord_listen_channels`. That would overwrite the entire list instead of appending. Always use this skill.
- Discord must already be configured for the current agent.
- The bot must be a member of the guild (server) where the channel exists.
- Channel IDs are numeric Discord snowflakes (e.g. `1234567890123456789`).
