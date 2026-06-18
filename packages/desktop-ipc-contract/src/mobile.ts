// ---------- Mobile gateway (WebSocket bridge) ------------------------------

/**
 * Live status of the desktop's mobile gateway — the opt-in WebSocket bridge
 * that exposes the SAME IPC contract the renderer uses to a remote client (the
 * mobile app), letting a paired phone drive the host exactly like the TUI does.
 *
 * OFF by default; the user enables it explicitly from Settings → Mobile, which
 * binds the bridge on the LAN-advertised interface so a phone on the same Wi-Fi
 * can reach it (a deliberate local-network exposure, gated by the pairing
 * token). `connectUrl` IS the QR payload the mobile app scans — a
 * `ws(s)://host:port/?t=<token>` string the shipped app's `parsePairingQrPayload`
 * accepts verbatim.
 */
export interface MobileGatewayStatus {
  /** True while the bridge is running and accepting connections. */
  enabled: boolean;
  /** Advertised host a phone connects to (the LAN IP for a wildcard bind, or
   *  the bound host verbatim). Null while disabled. */
  host: string | null;
  /** Bound TCP port. Null while disabled. */
  port: number | null;
  /** The QR / manual-entry payload: `ws://host:port/?t=<token>`. Null while
   *  disabled. Scanning this in the mobile app pairs it to this host. */
  connectUrl: string | null;
  /** Current pairing token (also embedded in `connectUrl`). Null while
   *  disabled. */
  token: string | null;
  /** Number of mobile clients currently connected, when the transport can
   *  report it. */
  clientCount?: number;
}
