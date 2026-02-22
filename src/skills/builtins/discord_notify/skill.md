# Discord Notify

Use this skill to proactively send a message to the Discord channel currently paired with this agent.

This is useful for urgent alerts, autonomous status updates, and important notifications.

## Usage
Provide the message as arguments. All arguments are joined into one outbound message.

```bash
discord_notify "Urgent: production latency has exceeded 2s for 5 minutes."
```

## Notes
- Discord must already be configured and paired for the current agent.
- The channel ID is automatically stored when a user first messages the bot in Discord.
