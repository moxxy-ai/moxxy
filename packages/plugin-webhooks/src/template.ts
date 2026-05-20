import type { WebhookTrigger } from './store.js';

/**
 * Prompt template substitution. Supported placeholders:
 *   {body}            raw request body as utf-8 string
 *   {body_json}       pretty-printed JSON if body parses, else raw
 *   {header.<name>}   any HTTP header (case-insensitive)
 *   {method}          HTTP method
 *   {path}            HTTP path
 *   {trigger_name}    the trigger's slug
 *   {fired_at}        ISO timestamp of the firing
 *
 * Unknown placeholders are left in place (don't silently drop signal).
 * This keeps the templating dumb — anything fancier (jq-style paths,
 * filtering) belongs in a skill that runs after the prompt fires.
 */

export interface TemplateContext {
  readonly trigger: WebhookTrigger;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: Buffer;
  readonly method: string;
  readonly path: string;
  readonly firedAt: Date;
}

const PLACEHOLDER_RE = /\{(body_json|body|method|path|trigger_name|fired_at|header\.[^}]+)\}/g;

export function renderPrompt(ctx: TemplateContext): string {
  const bodyStr = ctx.body.toString('utf8');
  let bodyJson: string | null = null;
  return ctx.trigger.prompt.replace(PLACEHOLDER_RE, (_, token: string) => {
    if (token === 'body') return bodyStr;
    if (token === 'body_json') {
      if (bodyJson === null) {
        try {
          bodyJson = JSON.stringify(JSON.parse(bodyStr), null, 2);
        } catch {
          bodyJson = bodyStr;
        }
      }
      return bodyJson;
    }
    if (token === 'method') return ctx.method;
    if (token === 'path') return ctx.path;
    if (token === 'trigger_name') return ctx.trigger.name;
    if (token === 'fired_at') return ctx.firedAt.toISOString();
    if (token.startsWith('header.')) {
      const name = token.slice('header.'.length).toLowerCase();
      const v = ctx.headers[name];
      if (Array.isArray(v)) return v.join(', ');
      if (typeof v === 'string') return v;
      return '';
    }
    return `{${token}}`;
  });
}
