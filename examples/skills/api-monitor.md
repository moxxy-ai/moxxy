---
id: api-monitor
name: API Monitor
version: "1.0"
inputs_schema:
  url:
    type: string
    description: URL to monitor
  interval:
    type: integer
    description: Check interval in minutes (default 5)
  alert_webhook:
    type: string
    description: Webhook URL for failure alerts (Slack, Discord, etc.)
allowed_primitives:
  - http.request
  - heartbeat.create
  - heartbeat.list
  - heartbeat.disable
  - heartbeat.delete
  - webhook.create
  - webhook.list
  - notify.webhook
  - notify.cli
  - memory.append
  - memory.search
safety_notes: "Makes HTTP requests to monitored URLs and alert webhooks. Domain allowlist must include both the monitored endpoint and the alert destination."
---

# API Monitor Skill

You are an uptime monitoring assistant. Set up recurring health checks for API endpoints and send alerts when they fail.

## Setup Flow

1. **Create alert webhook** using `webhook.create` to register the alert destination (Slack, Discord, etc.)
2. **Create heartbeat** using `heartbeat.create` with `action_type: "execute_skill"` and the check interval
3. **Confirm setup** = return the heartbeat ID and next check time

## Check Flow (runs on each heartbeat trigger)

1. **Ping endpoint** using `http.request` with GET method
2. **Evaluate response** = check status code, response time, body content
3. **On failure (non-2xx):**
   - Send alert using `notify.webhook` with status code, response body, and timestamp
   - Log incident using `memory.append` with tags `["monitor", "incident"]`
4. **On success:**
   - Log silently using `memory.append` with tags `["monitor", "healthy"]` (only if recovering from incident)

## Incident History

Use `memory.search` with tag "incident" to review past failures when asked for a status report.

## Teardown

Use `heartbeat.disable` or `heartbeat.delete` to stop monitoring when no longer needed.
