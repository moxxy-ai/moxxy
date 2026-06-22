const DEFAULT_BRIDGE_PORT = 8765;
const LOCAL_GATEWAY_URL = `ws://127.0.0.1:${DEFAULT_BRIDGE_PORT}`;

export function deriveGatewayUrlFromExpoHost(hostUri?: string | null): string {
  const host = extractHost(hostUri);
  return host ? `ws://${host}:${DEFAULT_BRIDGE_PORT}` : LOCAL_GATEWAY_URL;
}

export function chooseGatewayUrlForPairing(storedUrl: string | null | undefined, expoHostUri?: string | null): string {
  const derivedUrl = deriveGatewayUrlFromExpoHost(expoHostUri);
  if (!storedUrl) return derivedUrl;
  if (!isBridgeUrl(storedUrl)) return derivedUrl;

  const normalizedStored = normalizeGatewayUrl(storedUrl);
  if (isLoopbackUrl(normalizedStored) && !isLoopbackUrl(derivedUrl)) return derivedUrl;
  return normalizedStored;
}

export function normalizeGatewayUrl(value: string): string {
  const trimmed = recoverLatestAbsoluteUrl(value.trim());
  if (!trimmed) return LOCAL_GATEWAY_URL;

  const withProtocol = /^(?:https?|wss?):\/\//i.test(trimmed) ? trimmed : `ws://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.hostname}:${DEFAULT_BRIDGE_PORT}`;
    }
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return LOCAL_GATEWAY_URL;
    if (url.protocol === 'ws:' && !url.port) url.port = String(DEFAULT_BRIDGE_PORT);
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return withProtocol.replace(/\/+$/, '');
  }
}

function recoverLatestAbsoluteUrl(value: string): string {
  const matches = [...value.matchAll(/(?:https?|wss?):\/\//gi)];
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

function isBridgeUrl(value: string): boolean {
  return /^wss?:\/\//i.test(value.trim());
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
