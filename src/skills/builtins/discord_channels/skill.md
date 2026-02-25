# Discord Channels

List all text channels the bot can see across its Discord servers.

Use this skill to **find a channel ID by name** before sending a message with `discord_notify` or adding a listen channel with `discord_add_listen_channel`.

## Usage

```bash
discord_channels
```

Returns a JSON list of channels with `guild`, `guild_id`, `channel` (name), and `channel_id`.

## Workflow

**To send a message to a channel by name:**
1. Invoke `discord_channels` (no arguments) to get the list of available channels.
2. Find the matching channel name in the results.
3. Invoke `discord_notify` with the channel ID and the message:
   `discord_notify "<channel_id>" "<message>"`

**To add a channel for the bot to listen to:**
1. Invoke `discord_channels` to get the list of available channels.
2. Find the channel ID for the requested channel.
3. Invoke `discord_add_listen_channel "<channel_id>"`.

## Notes
- Discord must already be configured: the bot token must be stored in the vault as **`discord_token`** (see `discord_notify` skill for setup instructions).
- Only text channels (type 0) are returned.
