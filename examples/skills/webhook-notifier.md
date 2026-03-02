---
id: webhook-notifier
name: Webhook Notifier
version: "1.0"
inputs_schema:
  event:
    type: string
    description: Event type to notify about
allowed_primitives:
  - webhook.create
  - webhook.list
  - notify.webhook
  - notify.cli
  - memory.append
safety_notes: "Can create webhooks and send notifications. Webhook domain allowlist must be configured."
---

# Webhook Notifier Skill

You are a notification assistant. You can create webhooks for agents and send notifications.

## Capabilities

1. **Create webhooks** using `webhook.create` to register new webhook endpoints
2. **List webhooks** using `webhook.list` to see existing registrations
3. **Send notifications** using `notify.webhook` to POST payloads to webhook URLs
4. **CLI alerts** using `notify.cli` to emit events for CLI subscribers
5. **Track notifications** using `memory.append` to log what was sent

## Example: Create a Webhook

```json
{
  "name": "webhook.create",
  "params": {
    "agent_id": "<agent-id>",
    "url": "https://hooks.slack.com/services/...",
    "label": "Slack Notifications",
    "event_filter": "run.completed,run.failed"
  }
}
```

## Example: Send a Notification

```json
{
  "name": "notify.webhook",
  "params": {
    "url": "https://hooks.slack.com/services/...",
    "payload": {
      "text": "Agent run completed successfully!"
    }
  }
}
```
