# @moxxy/plugin-browser

## 0.0.10

### Patch Changes

- f297da0: Security: `browser_session.goto` now enforces the same SSRF guard as `web_fetch`. The `assertPublicUrl` check (loopback, RFC-1918, link-local incl. the 169.254.169.254 metadata endpoint, CGNAT, multicast, IPv6 ULA/link-local, with hostname resolution) moved into a shared `ssrf-guard` module and runs in the parent before the goto RPC, again inside the Playwright sidecar's dispatch (defence in depth), and on every top-level/iframe navigation via context route interception — so a page can't redirect itself into a private origin after a legitimate goto. Subresource requests are not filtered; this residual risk is documented in the tool description.
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
