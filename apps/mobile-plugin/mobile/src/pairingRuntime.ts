import { configurePlatform, configureTransport } from '@moxxy/client-core';
import {
  makeWsApiHandle,
  splitConnectUrl,
  type WsClientStatus,
} from '@moxxy/client-transport-ws';

export interface BridgePairingTarget {
  readonly url: string;
  readonly token: string;
  /** The agent's public-key fingerprint from the QR (`?fp=`). Present when the
   *  gateway is exposed through the E2E proxy relay; the transport pins it and
   *  runs the encrypted handshake so the bearer token never crosses the relay. */
  readonly fingerprint?: string;
}

export interface BridgePairingTransportHandle extends BridgePairingTarget {
  status(): WsClientStatus;
  close(): void;
}

interface BridgePairingTransportDeps {
  readonly configurePlatform: typeof configurePlatform;
  readonly configureTransport: typeof configureTransport;
  readonly makeWsApiHandle: typeof makeWsApiHandle;
}

export function resolveBridgePairingTarget(
  rawUrl: string,
  manualToken?: string | null,
  manualFingerprint?: string | null,
): BridgePairingTarget {
  const trimmed = rawUrl.trim();
  if (!/^wss?:\/\//i.test(trimmed)) {
    throw new Error('Paste the ws:// or wss:// URL printed by moxxy mobile.');
  }

  const split = splitConnectUrl(trimmed);
  const token = manualToken?.trim() || split.token?.trim();
  if (!token) {
    throw new Error('Missing mobile pairing token.');
  }
  // Prefer an explicit fingerprint (the QR path strips the URL down before this
  // point), otherwise recover it from the URL's `?fp=` (a hand-pasted relay URL).
  const fingerprint = manualFingerprint?.trim() || split.fingerprint?.trim();
  const url = cleanBridgeUrl(split.url);
  const secure = /^wss:\/\//i.test(url);
  const host = hostnameOf(url);

  // A `wss://` gateway is the self-hosted proxy relay — an untrusted intermediary
  // that terminates TLS. Without the E2E fingerprint the bearer token would ride
  // to the relay in the clear (a tampered/MITM'd QR, or a link from before E2E).
  // Refuse rather than silently downgrade to an unauthenticated plaintext bearer.
  if (secure && !fingerprint) {
    throw new Error(
      'This secure pairing link is missing its security fingerprint (?fp=). Re-scan the QR shown by moxxy on your computer.',
    );
  }

  // A `ws://` connection is unencrypted. Only ever allow it to a LAN/loopback
  // host (the same-Wi-Fi pairing path). Refuse cleartext to a public host: a
  // hostile QR could otherwise point ws:// at an attacker and leak the bearer in
  // the clear. The OS-level cleartext permission can't be scoped to dynamic LAN
  // IPs, so this is the real boundary. Off-network pairing uses wss:// + fp.
  if (!secure && !isLanOrLoopbackHost(host)) {
    throw new Error(
      'Refusing an unencrypted ws:// connection to a non-local host. Pair on the same Wi-Fi, or use the secure QR (wss://) shown by moxxy on your computer.',
    );
  }

  return {
    url,
    token,
    ...(fingerprint ? { fingerprint } : {}),
  };
}

export function openBridgePairingTransport(
  rawUrl: string,
  manualToken?: string | null,
  deps: BridgePairingTransportDeps = {
    configurePlatform,
    configureTransport,
    makeWsApiHandle,
  },
  onStatus?: (status: WsClientStatus) => void,
  manualFingerprint?: string | null,
): BridgePairingTransportHandle {
  const target = resolveBridgePairingTarget(rawUrl, manualToken, manualFingerprint);
  let status: WsClientStatus = 'connecting';
  const handle = deps.makeWsApiHandle({
    url: target.url,
    token: target.token,
    // E2E proxy relay: pin the agent fingerprint and run the encrypted handshake
    // (the bearer rides encrypted, the relay sees only ciphertext). Absent for a
    // plain LAN ws:// gateway, where the bearer rides the Sec-WebSocket-Protocol.
    ...(target.fingerprint ? { e2e: { pinnedFingerprint: target.fingerprint } } : {}),
    onStatus: (next) => {
      status = next;
      onStatus?.(next);
    },
  });
  deps.configureTransport(handle.api);
  deps.configurePlatform({});
  return {
    ...target,
    status: () => status,
    close: handle.close,
  };
}

function cleanBridgeUrl(rawUrl: string): string {
  const withoutQuery = rawUrl.split('#')[0]!.split('?')[0]!.trim();
  return withoutQuery.replace(/^(wss?:\/\/[^/]+)\/$/, '$1');
}

/** Hostname of a ws(s):// URL (regex, not `new URL`, so it's independent of the
 *  RN runtime's URL-polyfill handling of the ws scheme). IPv6 brackets stripped. */
function hostnameOf(url: string): string {
  const match = /^wss?:\/\/(\[[^\]]+\]|[^/:]+)/i.exec(url);
  return (match?.[1] ?? '').toLowerCase().replace(/^\[|\]$/g, '');
}

/** LAN / loopback / link-local / mDNS hosts the unencrypted `ws://` pairing path
 *  may reach (same-Wi-Fi pairing). Everything else must use the encrypted relay
 *  path (`wss://` + pinned fingerprint). */
function isLanOrLoopbackHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host.endsWith('.local')) return true;
  if (host.startsWith('127.')) return true; // loopback
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true; // RFC1918
  if (host.startsWith('169.254.')) return true; // link-local
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // 172.16.0.0–172.31.255.255
  return false;
}
