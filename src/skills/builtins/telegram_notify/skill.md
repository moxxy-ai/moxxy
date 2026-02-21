# Telegram Notify

Use this skill to proactively send a message to the Telegram user currently paired with this agent.

This is useful for urgent alerts, autonomous status updates, and important notifications.

## Usage
Provide the message as arguments. All arguments are joined into one outbound message.

```bash
telegram_notify "Urgent: production latency has exceeded 2s for 5 minutes."
```

## Notes
- Telegram must already be configured and paired for the current agent.
- Each Telegram bot/chat can only be bound to one agent.
