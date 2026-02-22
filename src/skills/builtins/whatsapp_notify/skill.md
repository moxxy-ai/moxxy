# WhatsApp Notify

Use this skill to proactively send a message to the WhatsApp user currently paired with this agent.

This is useful for urgent alerts, autonomous status updates, and important notifications.

## Usage
Provide the message as arguments. All arguments are joined into one outbound message.

```bash
whatsapp_notify "Urgent: production latency has exceeded 2s for 5 minutes."
```

## Notes
- WhatsApp (Twilio) must already be configured with account SID, auth token, and sender number.
- The user's WhatsApp number is automatically stored when they first message the bot.
- Messages are sent via the Twilio REST API.
