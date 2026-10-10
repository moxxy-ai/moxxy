import { z, type EventLogReader } from '@moxxy/sdk';

/**
 * Consent per site for the desktop's browser: the person allows a site once
 * and the agent then acts there without a prompt per click.
 *
 * The approval is the `browser_allow_site` tool's own result, so the session
 * log already records it for every client of the conversation, and the sites
 * allowed so far are a pure fold over that log — the same model as the app
 * grants of Computer Use.
 */

export const ALLOW_SITE_TOOL = 'browser_allow_site';

export const siteGrantSchema = z.object({ kind: z.literal('browser_site'), site: z.string().min(1).max(253) }).strict();
export type SiteGrant = z.infer<typeof siteGrantSchema>;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const ADDRESS = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/**
 * The site a URL or a bare host name belongs to: its host, lower-cased, with a
 * leading `www.` or `*.` dropped. Null for anything that is not an http(s)
 * page, and for a lone label such as `com` — allowing that would allow a whole
 * top-level domain.
 */
export function siteOf(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname
    .toLowerCase()
    .replace(/\.$/, '')
    .replace(/^(\*\.|www\.)/, '');
  if (!host) return null;
  if (!host.includes('.') && host !== 'localhost' && !ADDRESS.test(host)) return null;
  return host;
}

/** Whether `url` is on one of `sites` — the site itself or one of its subdomains; an address only exactly. */
export function siteAllows(sites: readonly string[], url: string): boolean {
  const site = siteOf(url);
  if (!site) return false;
  if (ADDRESS.test(site)) return sites.includes(site);
  return sites.some((allowed) => site === allowed || site.endsWith(`.${allowed}`));
}

/**
 * Whether `url` is served from the developer's own machine: `localhost`, a
 * `*.localhost` name or a loopback address. Nobody's account lives there, so
 * developer diagnostics need no site approval on it.
 */
export function isLocalDevSite(url: string): boolean {
  const site = siteOf(url);
  if (!site) return false;
  return site === 'localhost' || site.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(site) || site === '[::1]';
}

/** The sites approved in this conversation, in the order they were allowed. */
export function sitesFromLog(log: EventLogReader): string[] {
  const requested = new Set(
    log
      .ofType('tool_call_requested')
      .filter((event) => event.name === ALLOW_SITE_TOOL)
      .map((event) => event.callId),
  );
  const approved = new Set(log.ofType('tool_call_approved').map((event) => event.callId));
  const sites = new Set<string>();
  for (const result of log.ofType('tool_result')) {
    if (!result.ok || !requested.has(result.callId) || !approved.has(result.callId)) continue;
    const grant = siteGrantSchema.safeParse(result.output);
    if (grant.success) sites.add(grant.data.site);
  }
  return [...sites];
}

/** What the agent is told when it acts on a page whose site was not allowed. */
export function siteRefusal(url: string): string {
  const site = siteOf(url);
  if (!site) return `This tab is not showing a web page (${url}), so nothing was done. Open one with browser_navigate first.`;
  return (
    `The user has not allowed ${site} in this conversation yet, so nothing was done. ` +
    `Call ${ALLOW_SITE_TOOL} with site "${site}" and say why — the user is asked once for the whole site — ` +
    'then repeat this step.'
  );
}
