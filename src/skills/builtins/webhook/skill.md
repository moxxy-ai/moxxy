# webhook

Unified webhook management skill. Register, remove, enable, disable, update, or list webhook endpoints for receiving events from external services like GitHub, Stripe, Gmail, etc.

When an external service sends an event to a registered webhook URL, you will be automatically invoked with the payload and your prompt template as context.

## IMPORTANT: Setup Flow

Registering a webhook is a **two-step process** that requires user involvement:

1. **You register the webhook** using the `register` action below. This creates the endpoint on your side.
2. **The user must configure the external service** (GitHub, Stripe, etc.) with the webhook URL and secret you provide.

After registering, you MUST tell the user:
- The **Webhook URL** (returned by the register action)
- The **secret** they chose or you generated
- **Where to configure it** in the external service (e.g., "Go to your GitHub repo → Settings → Webhooks → Add webhook")
- **Which events** to subscribe to (e.g., "Select 'Releases' events only")

## Arguments

### source_slug Format

The `source_slug` is a **short URL-safe identifier** used as part of the webhook URL path. It must contain **only** alphanumeric characters, hyphens, and underscores.

- CORRECT: `github`, `stripe`, `gmail`, `github-releases`, `my_service`
- WRONG: `github:owner/repo`, `https://github.com`, `github.com/user/repo`

The source_slug does NOT encode the specific repo or resource — that context belongs in the `prompt_template`.

### secret

The `secret` is a shared HMAC key used to verify that incoming requests actually come from the external service. It is **required** for security.

**You MUST ask the user if they have a preferred webhook secret.** If they don't, generate a strong random one (at least 32 characters, alphanumeric + special chars) and give it to them so they can paste it into the external service's webhook configuration.

**NEVER fabricate a throwaway or weak secret** like "my_secret_123". Webhook secrets protect against unauthorized triggering of agent actions.

## Actions

### Register a new webhook
`<invoke name="webhook">["register", "name", "source_slug", "prompt_template", "secret"]</invoke>`

- **name**: Human-friendly identifier (e.g. "github-releases", "stripe-payments")
- **source_slug**: URL path segment — alphanumeric, hyphens, underscores ONLY (e.g. "github", "stripe")
- **prompt_template**: Instructions prepended to every incoming payload. Include context about what repo/resource this is for.
- **secret**: Shared HMAC secret for signature verification (REQUIRED for production use)

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

### GitHub Releases webhook

Step 1 — Ask the user for their preferred secret or generate one.

Step 2 — Register:
`<invoke name="webhook">["register", "moxxy-releases", "github-releases", "You received a GitHub webhook event for the moxxy-ai/moxxy repository. Check if payload.action is 'published' and payload.release exists. Extract the release name, tag, body, URL, and author. Compose an announcement and send it via discord_notify.", "wh_a7Bx9kQ2mP4nR8sT1vW3yZ5"]</invoke>`

Step 3 — Tell the user the webhook URL and secret, and instruct them to:
1. Go to https://github.com/moxxy-ai/moxxy/settings/hooks
2. Click "Add webhook"
3. Paste the Webhook URL
4. Set Content type to `application/json`
5. Paste the secret
6. Select "Let me select individual events" → check "Releases"
7. Click "Add webhook"

### Stripe payments webhook
`<invoke name="webhook">["register", "stripe-payments", "stripe", "You received a Stripe payment event. Extract amount, customer, and status.", "whsec_abc123def456"]</invoke>`

### List all webhooks
`<invoke name="webhook">["list"]</invoke>`

## Webhook URL Format
`http://<host>:<port>/api/webhooks/<agent_name>/<source_slug>`

## Signature Verification
Incoming requests are verified using HMAC-SHA256. Supported signature headers:
- **GitHub**: `X-Hub-Signature-256: sha256=<hex>`
- **Stripe**: `Stripe-Signature: t=<timestamp>,v1=<hex>`
- **Generic**: `X-Signature: <hex>`

Webhooks without a secret will reject all incoming events. Disabled webhooks will also reject events.
