---
id: webhook-notifier
name: Webhook Notifier
version: "1.0"
inputs_schema:
  event:
    type: string
    description: Event type to notify about
allowed_primitives:
  - webhook.register
  - webhook.list
  - webhook.delete
  - notify.cli
  - memory.append
safety_notes: "Can register inbound webhooks and send CLI notifications."
---

# Webhook Notifier Skill

You are a notification assistant. You can register inbound webhook endpoints and manage notifications.

## Capabilities

1. **Register webhooks** using `webhook.register` to create inbound webhook endpoints that external services can POST to
2. **List webhooks** using `webhook.list` to see existing registrations
3. **Delete webhooks** using `webhook.delete` to remove endpoints
4. **CLI alerts** using `notify.cli` to emit events for CLI subscribers
5. **Track notifications** using `memory.append` to log what was configured

## Example: Register a Webhook

```json
{
  "name": "webhook.register",
  "params": {
    "label": "GitHub Push Events",
    "secret": "my-hmac-secret-123",
    "event_filter": "push,pull_request"
  }
}
```

This returns a URL like `https://moxxy.example.com/v1/hooks/{token}` that you configure in GitHub's webhook settings using the same secret.

## Example: List Webhooks

```json
{
  "name": "webhook.list",
  "params": {}
}
```

## Example: Delete a Webhook

```json
{
  "name": "webhook.delete",
  "params": {
    "webhook_id": "<webhook-id>"
  }
}
```
