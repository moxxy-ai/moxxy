# Discord Channels

List all text channels the bot can see across its Discord servers.

Use this skill to **find a channel ID by name** before sending a message with `discord_notify`.

## Usage

```bash
discord_channels
```

Returns a JSON list of channels with `guild`, `guild_id`, `channel` (name), and `channel_id`.

## Workflow

When the user asks you to send a Discord message to a specific channel by name:

1. Invoke `discord_channels` (no arguments) to get the list of available channels.
2. Find the matching channel name in the results.
3. Invoke `discord_notify` with the channel ID and the message:
   `discord_notify "<channel_id>" "<message>"`

## Notes
- Discord must already be configured and paired for the current agent.
- Only text channels (type 0) are returned.
