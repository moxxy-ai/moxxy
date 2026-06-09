import { randomBytes } from 'node:crypto';
import { defineTool, z, type ToolDef } from '@moxxy/sdk';
import type { WebhookConfigStore } from './config.js';
import { describeTrigger } from './describe.js';
import type { WebhookDispatcher } from './runner.js';
import { renderPrompt } from './template.js';
import {
  filterRuleSchema,
  type WebhookFilter,
  type WebhookStore,
  type WebhookTrigger,
  type WebhookVerification,
} from './store.js';
import { isTunnelCliAvailable, startTunnel, type RunningTunnel } from './tunnel.js';

/**
 * Agent-facing tools. Tool descriptions are the contract with the
 * model — they have to read like a runbook for a non-technical user.
 *
 * Provider-agnostic by design: this plugin doesn't know GitHub from
 * Stripe from a private internal service. The setup guide walks the
 * agent through *asking* the user for the provider-specific bits
 * (header name, prefix, secret, events to include/exclude) rather than
 * baking any names in.
 */

export interface WebhooksToolDeps {
  readonly store: WebhookStore;
  readonly config: WebhookConfigStore;
  readonly dispatcher: WebhookDispatcher;
  readonly tunnelHandle: { current: RunningTunnel | null };
}

function generateSecret(): string {
  return randomBytes(32).toString('hex');
}

/** Input shape mirrors the store schema but lets the agent omit `secret`
 *  so the tool can mint a strong one. The handler normalizes to the
 *  store's stricter shape before persisting. */
const verificationInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('bearer'),
    secret: z.string().min(8).optional(),
  }),
  z.object({
    type: z.literal('hmac'),
    secret: z.string().min(8).optional(),
    signatureHeader: z.string().min(1),
    algorithm: z.enum(['sha256', 'sha1']).default('sha256'),
    prefix: z.string().optional(),
    scheme: z.enum(['plain', 'stripe']).default('plain'),
    timestampToleranceSec: z.number().int().positive().default(300),
  }),
]);

type VerificationInput = z.infer<typeof verificationInputSchema>;

const filterInputSchema = z.object({
  include: z.array(filterRuleSchema).default([]),
  exclude: z.array(filterRuleSchema).default([]),
});

interface NormalizedVerification {
  readonly verification: WebhookVerification;
  readonly secretIssued: string | null;
}

function normalizeVerification(input: VerificationInput): NormalizedVerification {
  if (input.type === 'none') {
    return { verification: { type: 'none' }, secretIssued: null };
  }
  if (input.type === 'bearer') {
    if (input.secret) return { verification: { type: 'bearer', secret: input.secret }, secretIssued: null };
    const secret = generateSecret();
    return { verification: { type: 'bearer', secret }, secretIssued: secret };
  }
  const provided = input.secret;
  const secret = provided ?? generateSecret();
  return {
    verification: {
      type: 'hmac',
      secret,
      signatureHeader: input.signatureHeader,
      algorithm: input.algorithm,
      scheme: input.scheme,
      timestampToleranceSec: input.timestampToleranceSec,
      ...(input.prefix ? { prefix: input.prefix } : {}),
    },
    secretIssued: provided ? null : secret,
  };
}

function fullUrl(publicUrl: string | undefined, triggerId: string): string | null {
  if (!publicUrl) return null;
  return `${publicUrl.replace(/\/$/, '')}/webhook/${triggerId}`;
}

export function buildWebhookTools(deps: WebhooksToolDeps): ReadonlyArray<ToolDef> {
  const { store, config, dispatcher, tunnelHandle } = deps;

  return [
    defineTool({
      name: 'webhook_create',
      description:
        'Create a webhook trigger. When an external system POSTs to the returned URL ' +
        'and verification (and any filters) pass, the configured prompt fires as a turn ' +
        'on the ACTIVE session (not an isolated one — output lands in the shared event ' +
        'log). `allowedTools` is enforced per fire: a non-empty list restricts the fire ' +
        'to exactly those tools (any other tool call is denied); an empty list leaves ' +
        "the session's full tool set available under its normal permission rules.\n\n" +
        'Verification picks the auth model:\n' +
        '  • `none`   — no auth. Anyone reaching the URL fires the trigger. Local-only.\n' +
        '  • `bearer` — secret in `Authorization: Bearer <secret>`. Simplest shared-secret.\n' +
        '  • `hmac`   — HMAC over the body, compared to a signature header. The user should ' +
        'paste the header name + signature prefix + algorithm from the external system\'s ' +
        'webhook documentation. Use `scheme:"stripe"` for systems that sign ' +
        '`<timestamp>.<body>` and pack it into a comma-separated header.\n\n' +
        'For `bearer`/`hmac`, if `secret` is omitted a strong 32-byte random secret is ' +
        'generated and returned ONCE in `secretIssued` — record it now.\n\n' +
        '`filters` decides whether a verified delivery actually fires the prompt:\n' +
        '  • `include` — fire only if at least one rule matches (or empty = fire on everything)\n' +
        '  • `exclude` — never fire if any rule matches\n' +
        'Each rule reads ONE field (a header or a dot-separated JSON path in the body) and ' +
        'compares it against `equals` (any-of) or `matches` (regex).\n\n' +
        "Prompt placeholders: `{body}`, `{body_json}`, `{header.<name>}`, `{method}`, " +
        "`{path}`, `{trigger_name}`, `{fired_at}`. The prompt is the runbook the model " +
        'reads on every delivery — write it that way.',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(120)
          .regex(/^[a-z0-9][a-z0-9-]*$/i, 'name must be slug-like'),
        prompt: z.string().min(1),
        allowedTools: z.array(z.string()).default([]),
        model: z.string().optional(),
        verification: verificationInputSchema,
        filters: filterInputSchema.optional(),
        idempotencyHeader: z.string().optional(),
        description: z.string().optional(),
      }),
      permission: { action: 'prompt' },
      handler: async (input) => {
        const { verification, secretIssued } = normalizeVerification(input.verification);
        const filters: WebhookFilter = input.filters ?? { include: [], exclude: [] };
        const trigger = await store.create({
          name: input.name,
          prompt: input.prompt,
          allowedTools: input.allowedTools,
          ...(input.model ? { model: input.model } : {}),
          verification,
          filters,
          ...(input.idempotencyHeader ? { idempotencyHeader: input.idempotencyHeader } : {}),
          ...(input.description ? { description: input.description } : {}),
        });

        const cfg = await config.get();
        const guidance: string[] = [];
        const url = fullUrl(cfg.publicUrl, trigger.id);
        if (!url) {
          guidance.push(
            'No public URL is configured yet. The trigger is saved but the external ' +
              'system has nowhere to POST until you (a) call `webhook_tunnel_start` to ' +
              'spawn a free cloudflared tunnel, (b) call `webhook_set_public_url` with a ' +
              'URL the user already has, or (c) call `webhook_setup_guide` for the walkthrough.',
          );
        } else {
          guidance.push(`Paste this URL into the external system's webhook config: ${url}`);
        }
        if (secretIssued) {
          guidance.push(
            "A secret was generated for this trigger — paste it into the external " +
              "system's webhook secret field. It will NOT be shown again: record it now. " +
              `Secret: ${secretIssued}`,
          );
        }
        return { trigger: describeTrigger(trigger, cfg.publicUrl), secretIssued, guidance };
      },
    }),

    defineTool({
      name: 'webhook_list',
      description:
        'List every webhook trigger with its current URL (if a public URL is set), last ' +
        'fire timestamp, and outcome. Secrets are never returned.',
      inputSchema: z.object({
        includeDisabled: z.boolean().default(true),
      }),
      handler: async ({ includeDisabled }) => {
        const triggers = await store.list();
        const cfg = await config.get();
        const filtered = includeDisabled ? triggers : triggers.filter((t) => t.enabled);
        return {
          publicUrl: cfg.publicUrl ?? null,
          listener: { host: cfg.host, port: cfg.port },
          triggers: filtered.map((t) => describeTrigger(t, cfg.publicUrl)),
        };
      },
    }),

    defineTool({
      name: 'webhook_delete',
      description:
        'Permanently remove a webhook trigger by id. Does NOT touch any subscription ' +
        "registered on the external side — the user must also delete the webhook from " +
        "the source's dashboard, otherwise it'll keep retrying.",
      inputSchema: z.object({ id: z.string().min(1) }),
      permission: { action: 'prompt' },
      handler: async ({ id }) => ({ deleted: await store.delete(id) }),
    }),

    defineTool({
      name: 'webhook_update',
      description:
        'Patch an existing webhook trigger. Useful for toggling enable, editing the ' +
        'prompt template, widening the allowedTools set, or tightening the filters. ' +
        'To rotate a secret, delete and recreate — silent secret rotation is intentionally ' +
        'unsupported.',
      inputSchema: z.object({
        id: z.string().min(1),
        enabled: z.boolean().optional(),
        prompt: z.string().min(1).optional(),
        allowedTools: z.array(z.string()).optional(),
        model: z.string().optional(),
        description: z.string().optional(),
        idempotencyHeader: z.string().optional(),
        filters: filterInputSchema.optional(),
      }),
      permission: { action: 'prompt' },
      handler: async ({ id, ...patch }) => {
        const updated = await store.update(id, patch);
        if (!updated) return { ok: false, reason: 'no trigger with that id' };
        const cfg = await config.get();
        return { ok: true, trigger: describeTrigger(updated, cfg.publicUrl) };
      },
    }),

    defineTool({
      name: 'webhook_test',
      description:
        'Fire a webhook trigger right now with a synthetic body + headers, bypassing the ' +
        'HTTP listener and signature verification. Filters DO still apply. Use this to ' +
        "validate the prompt + tools without waiting for the external system's first POST.",
      inputSchema: z.object({
        id: z.string().min(1),
        body: z.string().default('{}'),
        headers: z.record(z.string()).default({}),
      }),
      permission: { action: 'prompt' },
      handler: async ({ id, body, headers }) => {
        const trigger = await store.get(id);
        if (!trigger) throw new Error(`no trigger with id "${id}"`);
        const prompt = renderPrompt({
          trigger,
          headers,
          body: Buffer.from(body, 'utf8'),
          method: 'POST',
          path: `/webhook/${trigger.id}`,
          firedAt: new Date(),
        });
        const outcome = await dispatcher.fire(trigger, prompt, null);
        return {
          ok: outcome.ok,
          inboxPath: outcome.inboxPath ?? null,
          ...(outcome.error ? { error: outcome.error } : {}),
          text: outcome.text.slice(0, 4000),
        };
      },
    }),

    defineTool({
      name: 'webhook_status',
      description:
        'Report current webhook subsystem state: listener host/port, configured public ' +
        'URL (with provenance — manual vs. cloudflared tunnel), tunnel process status, ' +
        'count of triggers, and whether a tunnel CLI is detected on PATH. Call this as ' +
        'the first step when a user asks for webhook help.',
      inputSchema: z.object({}),
      handler: async () => {
        const cfg = await config.get();
        const triggers = await store.list();
        const [cloudflaredOk, ngrokOk] = await Promise.all([
          isTunnelCliAvailable('cloudflared'),
          isTunnelCliAvailable('ngrok'),
        ]);
        return {
          listener: { host: cfg.host, port: cfg.port },
          publicUrl: cfg.publicUrl ?? null,
          publicUrlSource: cfg.publicUrlSource ?? null,
          tunnel: tunnelHandle.current
            ? {
                running: true,
                kind: tunnelHandle.current.kind,
                url: tunnelHandle.current.url,
                pid: tunnelHandle.current.pid,
              }
            : { running: false },
          cliAvailable: { cloudflared: cloudflaredOk, ngrok: ngrokOk },
          triggerCount: triggers.length,
          enabledCount: triggers.filter((t) => t.enabled).length,
        };
      },
    }),

    defineTool({
      name: 'webhook_set_public_url',
      description:
        'Persist the public URL the external system will POST to. Use when the user ' +
        'already has a tunnel/proxy and just needs moxxy to remember it. The URL is stored ' +
        'at `~/.moxxy/webhooks-config.json`. If the user does NOT have a tunnel yet, ' +
        'prefer `webhook_tunnel_start` (auto-spawn) or `webhook_setup_guide` (walkthrough).',
      inputSchema: z.object({
        publicUrl: z.string().url('publicUrl must be a full URL like https://example.com'),
      }),
      permission: { action: 'prompt' },
      handler: async ({ publicUrl }) => {
        const updated = await config.set({ publicUrl, publicUrlSource: 'manual' });
        const triggers = await store.list();
        return {
          publicUrl: updated.publicUrl,
          updatedUrls: triggers.map((t) => ({ name: t.name, url: fullUrl(publicUrl, t.id) })),
        };
      },
    }),

    defineTool({
      name: 'webhook_clear_public_url',
      description:
        'Forget the configured public URL. Triggers stay in place but external systems ' +
        'will no longer be able to reach them until a new URL is set.',
      inputSchema: z.object({}),
      permission: { action: 'prompt' },
      handler: async () => {
        await config.clearPublicUrl();
        return { ok: true };
      },
    }),

    defineTool({
      name: 'webhook_tunnel_start',
      description:
        'Spawn a free public tunnel pointing at the local webhook listener. Default ' +
        '`kind:"cloudflared"` requires no signup — the tool runs `cloudflared tunnel ' +
        '--url localhost:<port>`, parses the printed `*.trycloudflare.com` URL, persists ' +
        'it as the public URL, and returns it. `kind:"ngrok"` works if the user has ngrok ' +
        'configured.\n\n' +
        'If the tunnel CLI is not installed, the tool returns a clear error with install ' +
        'instructions — at that point call `webhook_setup_guide` for the walkthrough.\n\n' +
        'Only one tunnel runs at a time; calling again stops the prior one first.',
      inputSchema: z.object({
        kind: z.enum(['cloudflared', 'ngrok']).default('cloudflared'),
        urlTimeoutMs: z.number().int().positive().default(30_000),
      }),
      permission: { action: 'prompt' },
      handler: async ({ kind, urlTimeoutMs }) => {
        const cfg = await config.get();
        const available = await isTunnelCliAvailable(kind);
        if (!available) {
          return {
            ok: false,
            error: `${kind} not found on PATH`,
            install: installInstructions(kind),
          };
        }
        if (tunnelHandle.current) {
          try { await tunnelHandle.current.stop(); } catch { /* ignore */ }
          tunnelHandle.current = null;
        }
        const running = await startTunnel({ kind, port: cfg.port, host: cfg.host, urlTimeoutMs });
        tunnelHandle.current = running;
        await config.set({ publicUrl: running.url, publicUrlSource: kind });
        const triggers = await store.list();
        return {
          ok: true,
          kind: running.kind,
          publicUrl: running.url,
          pid: running.pid,
          updatedUrls: triggers.map((t) => ({ name: t.name, url: fullUrl(running.url, t.id) })),
          note:
            'This tunnel lives only as long as the moxxy process. For long-running setups ' +
            'point a stable hostname (named cloudflared tunnel, Tailscale Funnel, reverse ' +
            'proxy) at the listener and call `webhook_set_public_url` instead.',
        };
      },
    }),

    defineTool({
      name: 'webhook_tunnel_stop',
      description: 'Stop the running tunnel started by `webhook_tunnel_start`, if any.',
      inputSchema: z.object({}),
      permission: { action: 'prompt' },
      handler: async () => {
        if (!tunnelHandle.current) return { ok: false, reason: 'no tunnel running' };
        const { kind } = tunnelHandle.current;
        try { await tunnelHandle.current.stop(); } catch { /* ignore */ }
        tunnelHandle.current = null;
        await config.clearPublicUrl();
        return { ok: true, stopped: kind };
      },
    }),

    defineTool({
      name: 'webhook_setup_guide',
      description:
        'Return a step-by-step setup script tailored to the current state. The agent ' +
        'treats this as a checklist: each step has a `title`, an `askUser` question to ' +
        'pose, and `recordAs` indicating which `webhook_create` field the answer becomes. ' +
        'Use this whenever a user wants to wire up a webhook but does NOT know the ' +
        "specifics of the external system's signing scheme, event names, or secret format.",
      inputSchema: z.object({}),
      handler: async () => buildSetupGuide({ store, config }),
    }),
  ];
}

function installInstructions(kind: 'cloudflared' | 'ngrok'): string {
  if (kind === 'cloudflared') {
    return [
      'macOS:   brew install cloudflared',
      'Linux:   download from https://github.com/cloudflare/cloudflared/releases',
      'Windows: winget install --id Cloudflare.cloudflared',
      '',
      'After installing, call webhook_tunnel_start again.',
    ].join('\n');
  }
  return [
    'macOS:   brew install ngrok',
    'Linux:   download from https://ngrok.com/download',
    '',
    'ngrok requires a free authtoken — run `ngrok config add-authtoken <token>` once ' +
      'after signing up at ngrok.com, then call webhook_tunnel_start again.',
  ].join('\n');
}

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

async function buildSetupGuide(deps: SetupGuideDeps): Promise<{
  publicUrlConfigured: boolean;
  tunnelCliAvailable: { cloudflared: boolean; ngrok: boolean };
  steps: ReadonlyArray<SetupStep>;
}> {
  const cfg = await deps.config.get();
  const [cloudflaredOk, ngrokOk] = await Promise.all([
    isTunnelCliAvailable('cloudflared'),
    isTunnelCliAvailable('ngrok'),
  ]);

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
  } else if (cloudflaredOk) {
    steps.push({
      step: 2,
      title: 'Public URL — auto-tunnel available',
      askUser:
        "I can spawn a free cloudflared tunnel for you — no signup, no account. Want me to do that?",
      nextToolCall: 'webhook_tunnel_start',
      hints: ['Default kind is `cloudflared`. The resulting URL is persisted automatically.'],
    });
  } else if (ngrokOk) {
    steps.push({
      step: 2,
      title: 'Public URL — ngrok available',
      askUser: 'I can spawn an ngrok tunnel for you. Should I?',
      nextToolCall: 'webhook_tunnel_start',
      hints: ['Pass `kind:"ngrok"`. Requires the user to have already run `ngrok config add-authtoken`.'],
    });
  } else {
    steps.push({
      step: 2,
      title: 'Public URL — need a tunnel',
      askUser:
        "Do you already have a public URL (ngrok, Tailscale Funnel, a reverse proxy, " +
        "anything that forwards to localhost), or should I help you set one up?",
      hints: [
        'If they already have one: call `webhook_set_public_url`.',
        'If they need help: install cloudflared (macOS `brew install cloudflared`, ' +
          'Linux/Windows: https://github.com/cloudflare/cloudflared/releases), then call ' +
          '`webhook_tunnel_start`.',
        'No vendor account needed for cloudflared quick tunnels.',
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
      'Omit `secret` in `webhook_create` to auto-generate. The response includes ' +
        '`secretIssued` exactly once — surface it to the user immediately and tell them ' +
        'to record it; we will not show it again.',
      'Never log the secret. Never echo it back in subsequent messages.',
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
      'Call `webhook_create` with the collected fields. Capture `secretIssued` and ' +
        '`trigger.url` from the response.',
      'Relay both to the user: the URL goes into the external system\'s webhook config; ' +
        'the secret goes into its signing-secret field.',
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
    tunnelCliAvailable: { cloudflared: cloudflaredOk, ngrok: ngrokOk },
    steps,
  };
}
