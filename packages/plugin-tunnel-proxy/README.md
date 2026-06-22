# @moxxy/plugin-tunnel-proxy

The self-hosted **proxy** tunnel provider — a native-Node replacement for the
cloudflared/ngrok subprocess providers. It exposes a local port at a stable,
keypair-derived public URL (`https://<uuid>.proxy.moxxy.ai`) by dialing the
proxy relay; there is no binary to install, no account, and no login.

## How it works

1. `open({ port, host })` loads the agent's identity key (`@moxxy/e2e/node`,
   `~/.moxxy/proxy-identity.key`) and dials the relay's control WebSocket
   (`wss://relay.<host>/control`).
2. The relay sends a challenge nonce; the provider signs it (proof of key
   ownership), and the relay derives `uuid = base32(sha256(pubkey))` and binds
   the subdomain. The provider cross-checks that the relay returned exactly the
   uuid its own key derives.
3. For every inbound peer the relay signals, the provider opens a `/data`
   WebSocket and pipes its raw bytes to `host:port`. It is protocol-agnostic —
   the bytes may be an (E2E-wrapped) phone WebSocket or a browser's HTTP.
4. The control connection self-heals with capped exponential backoff. The uuid
   is stable across reconnects because it derives from the (stable) public key.

The wire protocol is in [`src/protocol.ts`](./src/protocol.ts) — the single
coupling point with the private relay repo (see its `PROTOCOL.md`).

## Configuration

- `MOXXY_PROXY_HOST` — public base host (default `proxy.moxxy.ai`).
- `createProxyTunnel({ baseHost, controlUrl, identityPath })` — factory form,
  used by tests (point `controlUrl` at a local relay) and embedders.

## Security

End-to-end encryption against a malicious relay is **not** in this provider — it
is a dumb byte pipe. For the mobile path, the phone and a local E2E shim run the
`@moxxy/e2e` handshake *inside* the tunnel; this provider just carries the
ciphertext. The browser-preview path has no in-tunnel E2E and relies on the
relay's wildcard TLS (same posture as cloudflared/ngrok, but self-owned).
