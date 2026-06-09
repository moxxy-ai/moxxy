const DEFAULT_GATEWAY_PORT = 17902;
const LOCAL_GATEWAY_URL = `http://127.0.0.1:${DEFAULT_GATEWAY_PORT}`;

export function deriveGatewayUrlFromExpoHost(hostUri?: string | null): string {
  const host = extractHost(hostUri);
  return host ? `http://${host}:${DEFAULT_GATEWAY_PORT}` : LOCAL_GATEWAY_URL;
}

export function chooseGatewayUrlForPairing(storedUrl: string | null | undefined, expoHostUri?: string | null): string {
  const derivedUrl = deriveGatewayUrlFromExpoHost(expoHostUri);
  if (!storedUrl) return derivedUrl;

  const normalizedStored = normalizeGatewayUrl(storedUrl);
  if (isLoopbackUrl(normalizedStored) && !isLoopbackUrl(derivedUrl)) return derivedUrl;
  return normalizedStored;
}

export function normalizeGatewayUrl(value: string): string {
  const trimmed = recoverLatestAbsoluteUrl(value.trim());
  if (!trimmed) return LOCAL_GATEWAY_URL;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    url.pathname = normalizeGatewayPath(url.pathname);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return withProtocol.replace(/\/+$/, '');
  }
}

function recoverLatestAbsoluteUrl(value: string): string {
  const matches = [...value.matchAll(/https?:\/\//gi)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const start = matches[index].index;
    if (typeof start !== 'number') continue;
    const candidate = value.slice(start).trim();
    try {
      new URL(candidate);
      return candidate;
    } catch {
      // Keep scanning older candidates.
    }
  }
  return value;
}

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  } catch {
    return false;
  }
}

function extractHost(hostUri?: string | null): string | null {
  if (!hostUri) return null;
  const withoutProtocol = hostUri.replace(/^[a-z]+:\/\//i, '');
  const hostWithPort = withoutProtocol.split('/')[0] ?? '';
  const host = hostWithPort.split(':')[0];
  return host.length > 0 ? host : null;
}

function normalizeGatewayPath(pathname: string): string {
  return pathname.replace(/\/mobile\/v1(?:\/(?:pairing|pair|snapshot|health))?\/?$/, '') || '/';
}
