# @moxxy/e2e

## 0.1.8

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.1.7

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.1.6

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.1.5

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.1.4

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.1.3

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.1.2

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.1.1

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.1.0

### Minor Changes

- b19d401: Self-hosted **proxy** tunnel — a private replacement for ngrok/cloudflared.

  A locally-running agent is exposed at `https://<uuid>.proxy.moxxy.ai` via a
  self-hosted relay it dials outbound. Identity is a per-install Ed25519 keypair
  (no account, no login — the headless CLI works): `uuid = base32(sha256(pubkey))`,
  ownership proven by signing a relay challenge. One agent multiplexes several
  local services under its subdomain via path routing (`/mobile`, `/web`,
  `/webhook`).

  The mobile pairing path is **end-to-end encrypted inside the tunnel**
  (`@moxxy/e2e`): the QR carries the agent's public-key fingerprint (`?fp=`), the
  app pins it and runs a signed-ephemeral-ECDH handshake + XChaCha20-Poly1305
  framing, and the bearer token rides encrypted — so the relay (which terminates
  the outer TLS) sees only ciphertext it can neither read nor forge, and cannot
  impersonate the agent.

  The desktop **Settings → Mobile** "Start mobile" toggle now opens the same E2E
  proxy path: enabling the gateway exposes it at `wss://<uuid>.proxy.moxxy.ai/mobile`
  (QR + pinned fingerprint) so a phone can pair from anywhere, not just the same
  Wi-Fi. If the relay is unreachable it falls back to the LAN URL; `MOXXY_MOBILE_NO_PROXY=1`
  forces LAN-only. (`openMobileProxyTunnel` is exported from
  `@moxxy/plugin-channel-mobile/e2e-proxy`, shared by the CLI channel and the desktop.)

  **Breaking (`@moxxy/sdk`):** `proxy` is now the sole tunnel provider —
  `cloudflared`/`ngrok` and the `spawnCliTunnel` / `isCliTunnelAvailable` helpers
  (plus `SpawnCliTunnelOptions` / `CliTunnelHandle`) were removed. `TunnelOpenOptions`
  gains an optional `label` for path-routed multiplexing. The web preview and the
  webhooks listener now expose themselves through the proxy relay; the
  `webhook_tunnel_start` tool no longer takes a `kind`.

  The relay server itself lives in a separate private repo (not published).

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0
