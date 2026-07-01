# @moxxy/plugin-channel-web

## 0.1.12

### Patch Changes

- @moxxy/sdk@0.25.0
- @moxxy/plugin-tunnel-proxy@0.1.12

## 0.1.11

### Patch Changes

- @moxxy/sdk@0.24.1
- @moxxy/plugin-tunnel-proxy@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0
  - @moxxy/plugin-tunnel-proxy@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0
  - @moxxy/plugin-tunnel-proxy@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0
  - @moxxy/plugin-tunnel-proxy@0.1.8

## 0.1.7

### Patch Changes

- @moxxy/sdk@0.21.1
- @moxxy/plugin-tunnel-proxy@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0
  - @moxxy/plugin-tunnel-proxy@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0
  - @moxxy/plugin-tunnel-proxy@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0
  - @moxxy/plugin-tunnel-proxy@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0
  - @moxxy/plugin-tunnel-proxy@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0
  - @moxxy/plugin-tunnel-proxy@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1
  - @moxxy/plugin-tunnel-proxy@0.1.1

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
  - @moxxy/plugin-tunnel-proxy@0.1.0

## 0.0.25

### Patch Changes

- Updated dependencies [92fecb8]
  - @moxxy/sdk@0.15.2

## 0.0.24

### Patch Changes

- Updated dependencies [e762d40]
  - @moxxy/sdk@0.15.1

## 0.0.23

### Patch Changes

- Updated dependencies [cbf115b]
  - @moxxy/sdk@0.15.0

## 0.0.22

### Patch Changes

- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
- Updated dependencies [50a5b38]
  - @moxxy/sdk@0.14.5

## 0.0.21

### Patch Changes

- Updated dependencies [897a1fc]
  - @moxxy/sdk@0.14.4

## 0.0.20

### Patch Changes

- Updated dependencies [5f20dab]
  - @moxxy/sdk@0.14.3

## 0.0.19

### Patch Changes

- Updated dependencies [091ef41]
  - @moxxy/sdk@0.14.2

## 0.0.18

### Patch Changes

- Updated dependencies [640d036]
  - @moxxy/sdk@0.14.1

## 0.0.17

### Patch Changes

- Updated dependencies [e1fb6a6]
- Updated dependencies [e1fb6a6]
  - @moxxy/sdk@0.14.0

## 0.0.16

### Patch Changes

- Updated dependencies [89ad994]
  - @moxxy/sdk@0.13.0

## 0.0.15

### Patch Changes

- 7366a09: Add a cross-channel file-diff preview for the Write/Edit tools. Every surface
  now shows what changed when the agent writes a file — a classic diff of the
  changed slices (±2 context lines) with line numbers, `+`/`-` markers, and
  green/red line backgrounds, plus a "Added N lines, removed M lines" summary.

  - The tools return a structured, channel-agnostic payload (`ToolDisplayResult`
    = `{ forModel, display }`); the model still sees only a short summary line, so
    the diff never bloats the context window.
  - TUI: an inline highlight preview; `Ctrl+O` expands the changed files.
  - Desktop: a diff card; click to expand the full set of hunks.
  - Web / Telegram / mobile each render the same payload natively.

  New public SDK surface (`@moxxy/sdk` and the dependency-free `@moxxy/sdk/tool-display`
  subpath for browser/React-Native consumers): `FileDiffDisplay`, `DiffHunk`,
  `DiffLine`, `DiffRow`, `ToolDisplay`, `ToolDisplayResult`, and the helpers
  `isToolDisplayResult`, `isFileDiffDisplay`, `fileDiffSummary`, `fileDiffVerb`,
  `diffGutterNo`, `toDiffRows`.

- Updated dependencies [33e9640]
- Updated dependencies [143264a]
- Updated dependencies [7366a09]
- Updated dependencies [951f374]
  - @moxxy/sdk@0.12.0

## 0.0.14

### Patch Changes

- Updated dependencies [aacdf1d]
  - @moxxy/sdk@0.11.0

## 0.0.13

### Patch Changes

- Updated dependencies [2796066]
  - @moxxy/sdk@0.10.0

## 0.0.12

### Patch Changes

- 1e4ed09: chore(debt): unify tunnel spawning, finish MoxxyError adoption, retire stale casts

  Round-3 tech-debt drawdown:

  - **Tunnel unification (P2 #4).** New `spawnCliTunnel` + `isCliTunnelAvailable` exports on
    `@moxxy/sdk` own the spawn → parse-URL → resolve/reject lifecycle and no-orphan child
    cleanup for CLI tunnels. cloudflared/ngrok (channel-web) are now thin configs over it,
    and the webhooks plugin consumes registered `TunnelProviderDef`s instead of its own
    `startTunnel` (same URLs parsed, same teardown/pid/stop surface). channel-web's
    `child-cleanup.ts` is removed (folded into the SDK helper).
  - **MoxxyError adoption (P2 #5).** User-facing throws migrated to typed `MoxxyError`:
    oauth_authorize missing deviceUrl/authUrl (`TOOL_ERROR`), vault placeholder missing entry
    (`CONFIG_INVALID`), vault_get not-found (`TOOL_ERROR`), unsupported vault file
    (`VAULT_CORRUPT`). Internal invariant throws stay plain `Error`.
  - **Casts / hardcoded values (P3 #8).** Removed the `as unknown` exec-allowlist cast in
    plugin-security (CapabilitySpec.commands is now typed), tightened the Anthropic provider's
    `requestBody`/`countTokens` casts to the SDK's real param types (narrow, commented casts
    only where the SDK literal-narrows `media_type`), and corrected stale hardcoded model
    context windows (opus-4-7 / sonnet-4-6 are 1M, not 800k/200k) + maxOutputTokens.
  - **RemoteSession seam casts (P1 #1).** Dropped the redundant `as unknown as SessionLike`
    and command-handler casts in `desktop-host` (RemoteSession implements ClientSession →
    SessionLike; CommandContext.session is `unknown`).

- Updated dependencies [1e4ed09]
- Updated dependencies [4a8ec5d]
- Updated dependencies [6afc4c0]
  - @moxxy/sdk@0.9.0

## 0.0.11

### Patch Changes

- cf2f651: Security: four audit leftovers (A43–A46). MCP server credentials now support `${vault:NAME}` placeholders in env/header values, resolved only at connect time (the persisted mcp.json and the model-visible tool args keep the placeholder; `mcp_add_server`/`mcp_test_server` instruct vault-first). Agent-view URLs are scheme-allow-listed (`https`/`http`/`mailto`/`tel` + relative; `data:image/*` for img src only) at BOTH walls: a canonical `isSafeViewUrl` in the sdk enforced by `parseView` and `validateDoc`, and a render-time re-check in the web frontend that neutralizes `javascript:`/`data:text` hrefs and srcs. `web_fetch` closes its DNS-rebinding TOCTOU by pinning every hop's connection to the SSRF-guard-vetted addresses via an undici dispatcher with a fixed lookup (SNI/cert validation intact). Telegram inline-keyboard callbacks now enforce the same pairing authorization gate as text/voice messages.
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
- Updated dependencies [cf2f651]
  - @moxxy/sdk@0.8.1

## 0.0.10

### Patch Changes

- Updated dependencies [0326fb0]
- Updated dependencies [2e4bc37]
- Updated dependencies [f3c798f]
- Updated dependencies [0326fb0]
  - @moxxy/sdk@0.8.0

## 0.0.9

### Patch Changes

- Updated dependencies [85f9b91]
  - @moxxy/sdk@0.7.0

## 0.0.8

### Patch Changes

- Updated dependencies [eac83e5]
  - @moxxy/sdk@0.6.0

## 0.0.7

### Patch Changes

- Updated dependencies [b928391]
  - @moxxy/sdk@0.5.1

## 0.0.6

### Patch Changes

- Updated dependencies [ad26425]
- Updated dependencies [e64aa0e]
  - @moxxy/sdk@0.5.0

## 0.0.5

### Patch Changes

- Updated dependencies [b014c3a]
  - @moxxy/sdk@0.4.0

## 0.0.4

### Patch Changes

- Updated dependencies [d362a6b]
  - @moxxy/sdk@0.3.0

## 0.0.3

### Patch Changes

- Updated dependencies [0afd61d]
  - @moxxy/sdk@0.2.0

## 0.0.2

### Patch Changes

- Updated dependencies [93d9a2d]
  - @moxxy/sdk@0.1.3

## 0.0.1

### Patch Changes

- Updated dependencies [c4352f9]
  - @moxxy/sdk@0.1.0
  - @moxxy/core@0.0.1
