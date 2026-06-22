import type { WebhookConfigStore } from '../config.js';
import type { WebhookStore } from '../store.js';

interface SetupGuideDeps {
  readonly store: WebhookStore;
  readonly config: WebhookConfigStore;
}

interface SetupStep {
  readonly step: number;
  readonly title: string;
  /** Optional — present when this step has nothing for the agent to ask. */
  readonly status?: string;
  /** Question the agent should pose to the user, conversationally. */
  readonly askUser?: string;
  /** Hints to relay or use when interpreting the answer. */
  readonly hints?: ReadonlyArray<string>;
  /** Which `webhook_create` input field this collects. */
  readonly recordAs?: string;
  /** When the agent should skip this step entirely. */
  readonly skipWhen?: string;
  /** Tool to call once the answer is in hand. */
  readonly nextToolCall?: string;
}

export async function buildSetupGuide(deps: SetupGuideDeps): Promise<{
  publicUrlConfigured: boolean;
  steps: ReadonlyArray<SetupStep>;
}> {
  const cfg = await deps.config.get();

  const steps: SetupStep[] = [];

  steps.push({
    step: 1,
    title: 'Identify the source',
    askUser:
      'Which external system will send the webhooks (e.g. a vendor name, internal ' +
      'service, or "I will fire them by hand")? This is for the trigger name only — ' +
      "we don't bake any vendor-specific logic in.",
    recordAs: 'name',
    hints: [
      'Pick something short, slug-like (lowercase letters, digits, hyphens).',
      'Example slugs: payments-prod, repo-events, billing-test',
    ],
  });

  if (cfg.publicUrl) {
    steps.push({
      step: 2,
      title: 'Public URL — already configured',
      status: `${cfg.publicUrl} (source: ${cfg.publicUrlSource ?? 'manual'})`,
      hints: [
        'Skip this step. If the user wants a different URL, call ' +
          '`webhook_set_public_url` or `webhook_tunnel_start`.',
      ],
    });
  } else {
    steps.push({
      step: 2,
      title: 'Public URL — proxy relay available',
      askUser:
        'I can expose the listener through the self-hosted proxy relay — no signup, no ' +
        'account, no CLI to install. Want me to do that? (Or, if you already have a ' +
        'public URL, I can just record it.)',
      nextToolCall: 'webhook_tunnel_start',
      hints: [
        'Call `webhook_tunnel_start` — the resulting URL is persisted automatically.',
        'If they already have a stable public URL (Tailscale Funnel, a reverse proxy, ' +
          'anything that forwards to localhost): call `webhook_set_public_url` instead.',
      ],
    });
  }

  steps.push({
    step: 3,
    title: 'Verification — how does the source prove a request is real',
    askUser:
      'How does the external system sign or authenticate its requests? Open their ' +
      'webhook documentation and tell me:\n' +
      '  • Do they use a shared bearer token (e.g. an `Authorization: Bearer ...` header)?\n' +
      '  • Or do they sign the request body with a secret and put a signature in a header?\n' +
      '  • Or neither (no signing — only safe for local-only setups)?',
    recordAs: 'verification.type',
    hints: [
      'Answer maps to `webhook_create.verification.type` as `bearer` | `hmac` | `none`.',
      'If unsure but they mention "HMAC", "SHA-256", or "signature header" — use `hmac`.',
      'For `hmac`, also ask for: signature header name (e.g. the docs will name it), ' +
        'algorithm (almost always sha256), any prefix the value carries (e.g. `sha256=`), ' +
        'and whether the signed payload is just the body (`scheme:"plain"`) or a ' +
        '`<timestamp>.<body>` combo packed into the same header (`scheme:"stripe"`).',
    ],
  });

  steps.push({
    step: 4,
    title: 'Secret',
    askUser:
      'If verification is `bearer` or `hmac`, do you already have the secret from the ' +
      'external system, or should I generate one for you?\n' +
      "  • If they already created the webhook on the source's side and the docs gave " +
      'them a signing secret, paste it here.\n' +
      "  • If they're about to create the webhook, I can generate a strong random one " +
      'and they will paste it into the source.',
    recordAs: 'verification.secret',
    hints: [
      'Omit `secret` in `webhook_create` to auto-generate. The full value is written to ' +
        'an owner-only file (the response\'s `generatedSecret.path`) instead of being ' +
        'returned — relay the path and have the USER open the file and paste the value ' +
        'into the external system themselves.',
      'Never log the secret. Never read the secret file into the conversation or echo ' +
        'the value in messages.',
    ],
  });

  steps.push({
    step: 5,
    title: 'Filters — which deliveries should actually fire the prompt',
    askUser:
      "External systems often send many event types. Which should fire the agent, and " +
      'which should be ignored?\n' +
      '  • Include-only: list the event types/values that should fire (everything else is dropped).\n' +
      "  • Exclude-only: list the event types/values to ignore (everything else fires).\n" +
      '  • Both: combine them.\n' +
      "If the user isn't sure, fire on everything for now and they can tighten later via " +
      '`webhook_update`.',
    recordAs: 'filters',
    hints: [
      'Each rule reads ONE field. Two sources are supported:',
      '  - `header` — a request header (e.g. event type often lives in a dedicated header).',
      '  - `jsonPath` — a dot-separated path into the JSON body (e.g. `action` or ' +
        '`pull_request.merged`).',
      'Compare with `equals: [...]` (any-of, string-coerced) or `matches: "regex"`.',
      'Default `filters: { include: [], exclude: [] }` = fire on every verified delivery.',
    ],
  });

  steps.push({
    step: 6,
    title: 'Idempotency',
    askUser:
      "Does the external system include a unique delivery id header (so we can dedupe " +
      "retries)? If so, what's the header name?",
    recordAs: 'idempotencyHeader',
    hints: [
      'Common names include things like `X-Delivery-Id`, `X-Event-Id`, `Idempotency-Key`.',
      "If they don't know, leave it unset — duplicate deliveries from the source are " +
        'usually rare and the worst case is the prompt running twice.',
    ],
  });

  steps.push({
    step: 7,
    title: 'Prompt + tools',
    askUser:
      'What should the agent DO when a delivery fires? Describe the runbook. Then: ' +
      'which tools should it have access to (read-only fetch? bash? a specific MCP tool?)? ' +
      'A non-empty `allowedTools` is enforced — the fire can only execute the listed ' +
      'tools; everything else is denied. An empty list gives the fire the FULL tool set ' +
      'of the active session (fires are not isolated), so list only what you trust.',
    recordAs: 'prompt + allowedTools',
    hints: [
      'Use placeholders like `{body_json}` so the prompt sees the actual delivery payload.',
      'Common safe starting set: `allowedTools: ["web_fetch", "memory_save"]`. Add bash ' +
        'only if the runbook actually needs shell.',
    ],
  });

  steps.push({
    step: 8,
    title: 'Create the trigger',
    nextToolCall: 'webhook_create',
    hints: [
      'Call `webhook_create` with the collected fields. Capture `generatedSecret` ' +
        '(masked preview + file path) and `trigger.url` from the response.',
      "Relay both to the user: the URL goes into the external system's webhook config; " +
        'the secret lives in the file at `generatedSecret.path` — the user opens it ' +
        "themselves and pastes the value into the external system's signing-secret field.",
    ],
  });

  steps.push({
    step: 9,
    title: 'Verify end-to-end',
    nextToolCall: 'webhook_test',
    hints: [
      'Fire `webhook_test` with a representative body + headers to confirm the prompt + ' +
        'tools work before the real source POSTs. Outcomes land in ' +
        '`~/.moxxy/inbox/webhooks/`.',
    ],
  });

  return {
    publicUrlConfigured: !!cfg.publicUrl,
    steps,
  };
}
