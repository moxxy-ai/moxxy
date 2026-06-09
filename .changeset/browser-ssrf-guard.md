---
'@moxxy/plugin-browser': patch
---

Security: `browser_session.goto` now enforces the same SSRF guard as `web_fetch`. The `assertPublicUrl` check (loopback, RFC-1918, link-local incl. the 169.254.169.254 metadata endpoint, CGNAT, multicast, IPv6 ULA/link-local, with hostname resolution) moved into a shared `ssrf-guard` module and runs in the parent before the goto RPC, again inside the Playwright sidecar's dispatch (defence in depth), and on every top-level/iframe navigation via context route interception — so a page can't redirect itself into a private origin after a legitimate goto. Subresource requests are not filtered; this residual risk is documented in the tool description.
