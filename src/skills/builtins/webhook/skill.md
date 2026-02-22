# webhook

Unified webhook management skill. Register, remove, enable, disable, update, or list webhook endpoints for receiving events from external services like Stripe, GitHub, Gmail, etc.

When an external service sends an event to a registered webhook URL, you will be automatically invoked with the payload and your prompt template as context.

## Actions

### Register a new webhook
`<invoke name="webhook">["register", "name", "source_slug", "prompt_template", "secret"]</invoke>`

- **name**: Human-friendly identifier (e.g. "stripe-payments")
- **source_slug**: URL path segment — alphanumeric, hyphens, underscores only (e.g. "stripe")
- **prompt_template**: Instructions prepended to every incoming payload
- **secret** (optional): Shared secret for HMAC signature verification

### Remove a webhook
`<invoke name="webhook">["remove", "webhook_name"]</invoke>`

### Enable a disabled webhook
`<invoke name="webhook">["enable", "webhook_name"]</invoke>`

### Disable a webhook (keeps registration, stops processing)
`<invoke name="webhook">["disable", "webhook_name"]</invoke>`

### Update a webhook (re-registers with new settings)
`<invoke name="webhook">["update", "name", "source_slug", "new_prompt_template", "new_secret"]</invoke>`

### List all registered webhooks
`<invoke name="webhook">["list"]</invoke>`

## Examples

Register a GitHub webhook:
`<invoke name="webhook">["register", "github-push", "github", "You received a GitHub push event. Analyze the commits and summarize what changed.", "whsec_abc123"]</invoke>`

Register a Stripe webhook (no signature verification):
`<invoke name="webhook">["register", "stripe-payments", "stripe", "You received a Stripe payment event. Extract amount, customer, and status."]</invoke>`

Disable temporarily:
`<invoke name="webhook">["disable", "stripe-payments"]</invoke>`

Re-enable:
`<invoke name="webhook">["enable", "stripe-payments"]</invoke>`

Remove when no longer needed:
`<invoke name="webhook">["remove", "github-push"]</invoke>`

List all webhooks:
`<invoke name="webhook">["list"]</invoke>`

## Notes
- The webhook URL format is: `http://<host>:<port>/api/webhooks/<agent_name>/<source_slug>`
- If a secret is provided, incoming requests must include a valid HMAC signature (GitHub X-Hub-Signature-256, Stripe Stripe-Signature, or generic X-Signature).
- Disabled webhooks will reject incoming events without deleting the registration.
