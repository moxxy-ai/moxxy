# @moxxy/plugin-mcp

## 0.0.38

### Patch Changes

- @moxxy/sdk@0.25.0

## 0.0.37

### Patch Changes

- @moxxy/sdk@0.24.1

## 0.0.36

### Patch Changes

- Updated dependencies [f71c8bd]
  - @moxxy/sdk@0.24.0

## 0.0.35

### Patch Changes

- Updated dependencies [aec6e0e]
  - @moxxy/sdk@0.23.0

## 0.0.34

### Patch Changes

- Updated dependencies [48542df]
- Updated dependencies [f980349]
- Updated dependencies [1dc1697]
- Updated dependencies [069cd0e]
  - @moxxy/sdk@0.22.0

## 0.0.33

### Patch Changes

- @moxxy/sdk@0.21.1

## 0.0.32

### Patch Changes

- Updated dependencies [074f845]
- Updated dependencies [3a4b604]
  - @moxxy/sdk@0.21.0

## 0.0.31

### Patch Changes

- Updated dependencies [2ccd62e]
- Updated dependencies [9bff8a1]
- Updated dependencies [bddaa83]
- Updated dependencies [5c1c334]
- Updated dependencies [2ccd62e]
  - @moxxy/sdk@0.20.0

## 0.0.30

### Patch Changes

- Updated dependencies [08f927a]
  - @moxxy/sdk@0.19.0

## 0.0.29

### Patch Changes

- Updated dependencies [e4fe785]
  - @moxxy/sdk@0.18.0

## 0.0.28

### Patch Changes

- Updated dependencies [0d6df6e]
  - @moxxy/sdk@0.17.0

## 0.0.27

### Patch Changes

- Updated dependencies [648c966]
  - @moxxy/sdk@0.16.1

## 0.0.26

### Patch Changes

- Updated dependencies [b19d401]
  - @moxxy/sdk@0.16.0

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

- 897a1fc: Long-tail review fixes (quality sweep, t3 cluster):

  - plugin-oauth: thread the flow's abort signal into device-flow poll fetches (and the OpenAI token exchange) so a hung in-flight poll cancels, not just the inter-poll sleep; drop redundant clearTimeout calls in the callback server (settle() is the single cleanup chokepoint); document the credential-lock stale-takeover TOCTOU window.
  - plugin-vault: randomCode now draws width-appropriate entropy and rejection-samples — fixes the silent leading-digit cap for codes >= 10 digits and the modulo bias.
  - plugin-mcp: one malformed mcp.json entry no longer discards the whole server catalog (per-entry parse keeps valid rows); MCP resource results pass through inline text instead of a bare [resource]; createMcpPlugin connects servers in parallel (boot bounded at the slowest, not the sum).
  - plugin-scheduler: describeEntry shares the poller's next-fire baseline so the displayed next-fire agrees with when isDue fires; tickOnce counts due-and-attempted schedules (counts a fired-but-failed run).
  - workflows-builder: block-scalar parser strips indentation by the minimum body indent (no longer corrupts a literal block whose lines are shallower than the first).
  - runner: createUnixSocketServer.onConnection is single-handler (last-write-wins), consistent with Transport.onFrame/onClose.
  - mobile-poc: boot the env-URL transport in an effect (not a render-phase useState initializer); guard approval allow/deny against forwarding an empty optionId.

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
