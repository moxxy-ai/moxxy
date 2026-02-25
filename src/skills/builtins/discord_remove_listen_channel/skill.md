# Discord Remove Listen Channel

Remove a Discord channel from the bot's listen list. The bot will stop processing messages from this channel.

## Usage

```bash
discord_remove_listen_channel "<channel_id>"
```

## Notes

- **Do NOT use manage_vault** to modify `discord_listen_channels`. Always use this skill.
- Use `discord_channels` to find channel IDs if needed.
