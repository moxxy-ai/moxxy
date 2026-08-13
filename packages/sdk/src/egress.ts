/**
 * Outbound HTTP egress: corporate proxy support for everything moxxy fetches.
 *
 * Node's global `fetch` ignores `HTTPS_PROXY` entirely, and every provider
 * reaches its API through it (`@anthropic-ai/sdk`, `openai`, and the plain
 * `fetch` calls in tools). On a network that requires an outbound proxy that
 * means the first provider call fails with an opaque network error and there is
 * no setting that fixes it. Installing a global undici dispatcher is the only
 * way to route global `fetch` through a proxy.
 *
 * `undici` is imported DYNAMICALLY and only when a proxy is actually configured,
 * so `@moxxy/sdk` keeps zero hard runtime dependencies and a host with no proxy
 * pays nothing. The package is a real dependency of `@moxxy/cli`.
 *
 * Not handled here, on purpose: a corporate TLS-terminating CA is Node's job,
 * via `NODE_EXTRA_CA_CERTS=/path/to/ca.pem` in the environment before Node
 * starts. There is no in-process equivalent, so the doctor surfaces whether it
 * is set rather than pretending to configure it.
 */

/** Proxy inputs, already resolved from env and/or config. */
export interface EgressProxySettings {
  /** Proxy for `http:` origins. */
  readonly httpProxy?: string;
  /** Proxy for `https:` origins. */
  readonly httpsProxy?: string;
  /** Raw `NO_PROXY` value: comma/whitespace separated bypass rules. */
  readonly noProxy?: string;
}

export interface EgressStatus {
  /** True when a global dispatcher was installed. */
  readonly enabled: boolean;
  /** Credential-redacted proxy in use for `http:`, when set. */
  readonly httpProxy?: string;
  /** Credential-redacted proxy in use for `https:`, when set. */
  readonly httpsProxy?: string;
  /** Parsed bypass rules. */
  readonly noProxy?: ReadonlyArray<string>;
  /** Why nothing was installed, or why installation failed. */
  readonly reason?: string;
}

/**
 * Read proxy settings from an environment. Lowercase wins over uppercase, which
 * is the de-facto convention (curl, requests, Go): a shell that exports both
 * usually means the lowercase one was set deliberately and more recently.
 *
 * `http_proxy` is deliberately NOT used as a fallback for https origins. Some
 * environments set only `http_proxy` for a plaintext-only proxy, and silently
 * tunnelling TLS through it would fail confusingly rather than going direct.
 */
export function readProxyEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): EgressProxySettings {
  const pick = (lower: string, upper: string): string | undefined => {
    const value = (env[lower] ?? env[upper] ?? '').trim();
    return value.length > 0 ? value : undefined;
  };
  const httpProxy = pick('http_proxy', 'HTTP_PROXY');
  const httpsProxy = pick('https_proxy', 'HTTPS_PROXY');
  const noProxy = pick('no_proxy', 'NO_PROXY');
  return {
    ...(httpProxy ? { httpProxy } : {}),
    ...(httpsProxy ? { httpsProxy } : {}),
    ...(noProxy ? { noProxy } : {}),
  };
}

/** Split a `NO_PROXY` value into normalized rules. Separators are commas and
 *  whitespace; empty entries are dropped and matching is case-insensitive. */
export function parseNoProxy(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((rule) => rule.trim().toLowerCase())
    .filter((rule) => rule.length > 0);
}

/**
 * Whether `origin` bypasses the proxy under `rules` (already parsed by
 * {@link parseNoProxy}).
 *
 * Follows the de-facto `NO_PROXY` convention rather than inventing one:
 *   - `*` bypasses everything.
 *   - a bare host matches that host exactly, on any port.
 *   - a leading `.` or `*.` matches the domain and every subdomain, so
 *     `.corp.example` covers `api.corp.example` AND `corp.example`.
 *   - an entry carrying `:port` matches only that port; the origin's port is
 *     resolved from the scheme when the URL omits it.
 *
 * A malformed origin never bypasses: failing closed here sends the request
 * through the proxy, which an operator can observe, rather than silently
 * leaking it direct.
 */
export function shouldBypassProxy(origin: string, rules: ReadonlyArray<string>): boolean {
  if (rules.length === 0) return false;
  if (rules.includes('*')) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');

  for (const rule of rules) {
    const { host: ruleHost, port: rulePort } = splitRule(rule);
    if (rulePort !== undefined && rulePort !== port) continue;
    if (ruleHost.length === 0) continue;

    const suffix = ruleHost.startsWith('*.')
      ? ruleHost.slice(1)
      : ruleHost.startsWith('.')
        ? ruleHost
        : undefined;
    if (suffix) {
      // `.corp.example` covers the apex too, matching curl.
      if (host === suffix.slice(1) || host.endsWith(suffix)) return true;
      continue;
    }
    if (host === ruleHost) return true;
  }
  return false;
}

/**
 * Split a bypass rule into host and optional port.
 *
 * A bare IPv6 literal contains colons of its own, so `::1` must not be read as
 * host `:` on port `1`. As in a URL, a port qualifier on an IPv6 address
 * requires brackets (`[::1]:7000`); an unbracketed rule with more than one
 * colon is therefore an address, never a host:port pair.
 */
function splitRule(rule: string): { host: string; port?: string } {
  if (rule.startsWith('[')) {
    const end = rule.indexOf(']');
    if (end === -1) return { host: rule.slice(1) };
    const host = rule.slice(1, end);
    const rest = rule.slice(end + 1);
    return rest.startsWith(':') && /^\d+$/.test(rest.slice(1))
      ? { host, port: rest.slice(1) }
      : { host };
  }
  const first = rule.indexOf(':');
  if (first === -1 || first !== rule.lastIndexOf(':')) return { host: rule };
  const maybePort = rule.slice(first + 1);
  return /^\d+$/.test(maybePort)
    ? { host: rule.slice(0, first), port: maybePort }
    : { host: rule };
}

/**
 * A proxy URL with any embedded credentials masked, safe to log or show in
 * `moxxy doctor`. Proxy URLs routinely carry `user:password@`, and this string
 * ends up on terminals and in support pastes.
 */
export function redactProxyUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!url.username && !url.password) return url.toString();
    url.username = url.username ? '***' : '';
    url.password = url.password ? '***' : '';
    return url.toString();
  } catch {
    // Unparseable: reveal nothing rather than echoing a possible secret.
    return '<invalid proxy url>';
  }
}

/** True when at least one proxy is configured, i.e. there is work to do. */
export function hasProxy(settings: EgressProxySettings): boolean {
  return Boolean(settings.httpProxy ?? settings.httpsProxy);
}

interface UndiciModule {
  readonly Agent: new (opts?: unknown) => UndiciDispatcher;
  readonly ProxyAgent: new (opts: { uri: string }) => UndiciDispatcher;
  readonly setGlobalDispatcher: (dispatcher: UndiciDispatcher) => void;
}

interface UndiciDispatcher {
  dispatch(opts: { origin?: string | URL }, handler: unknown): boolean;
  close(): Promise<void>;
  destroy(): Promise<void>;
}

export interface InstallEgressProxyOptions {
  /** Surface for the "configured but unusable" case. Defaults to stderr. */
  readonly warn?: (message: string) => void;
  /** Injectable module loader for tests. */
  readonly loadUndici?: () => Promise<UndiciModule>;
}

/**
 * Install a global dispatcher routing outbound requests through the configured
 * proxy, honouring the bypass rules. No-ops (and reports why) when no proxy is
 * configured, so this is safe to call unconditionally at boot.
 *
 * Never throws: a broken proxy setting must degrade to a loud warning plus
 * direct connections, not a failed boot.
 */
export async function installEgressProxy(
  settings: EgressProxySettings,
  opts: InstallEgressProxyOptions = {},
): Promise<EgressStatus> {
  if (!hasProxy(settings)) return { enabled: false, reason: 'no proxy configured' };

  const warn = opts.warn ?? ((m: string) => process.stderr.write(`[moxxy] ${m}\n`));
  for (const [label, value] of [
    ['http_proxy', settings.httpProxy],
    ['https_proxy', settings.httpsProxy],
  ] as const) {
    if (value === undefined) continue;
    try {
      new URL(value);
    } catch {
      const reason = `${label} is not a valid URL; continuing without a proxy`;
      warn(reason);
      return { enabled: false, reason };
    }
  }

  let undici: UndiciModule;
  try {
    undici = await (opts.loadUndici ?? defaultLoadUndici)();
  } catch {
    const reason =
      'a proxy is configured but the `undici` package is unavailable; ' +
      'outbound requests will bypass it and may fail';
    warn(reason);
    return { enabled: false, reason };
  }

  const rules = parseNoProxy(settings.noProxy);
  const direct = new undici.Agent();
  const httpProxy = settings.httpProxy ? new undici.ProxyAgent({ uri: settings.httpProxy }) : undefined;
  const httpsProxy = settings.httpsProxy
    ? new undici.ProxyAgent({ uri: settings.httpsProxy })
    : undefined;

  const route = (origin: string | URL | undefined): UndiciDispatcher => {
    if (origin === undefined) return direct;
    const href = typeof origin === 'string' ? origin : origin.href;
    if (shouldBypassProxy(href, rules)) return direct;
    const secure = href.startsWith('https:');
    return (secure ? httpsProxy : httpProxy) ?? direct;
  };

  const all = [direct, httpProxy, httpsProxy].filter(Boolean) as UndiciDispatcher[];
  const router: UndiciDispatcher = {
    dispatch: (dispatchOpts, handler) => route(dispatchOpts.origin).dispatch(dispatchOpts, handler),
    close: async () => {
      await Promise.all(all.map((d) => d.close()));
    },
    destroy: async () => {
      await Promise.all(all.map((d) => d.destroy()));
    },
  };
  undici.setGlobalDispatcher(router);

  return {
    enabled: true,
    ...(settings.httpProxy ? { httpProxy: redactProxyUrl(settings.httpProxy) } : {}),
    ...(settings.httpsProxy ? { httpsProxy: redactProxyUrl(settings.httpsProxy) } : {}),
    ...(rules.length > 0 ? { noProxy: rules } : {}),
  };
}

async function defaultLoadUndici(): Promise<UndiciModule> {
  return (await import('undici')) as unknown as UndiciModule;
}
