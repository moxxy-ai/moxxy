---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

Support outbound HTTP proxies, so moxxy runs on networks that require one.

Node's global `fetch` ignores `HTTPS_PROXY`, and every provider call goes through it, so on a proxied corporate network the first request failed with an opaque error and no setting fixed it. A global dispatcher is now installed at startup from `http_proxy` / `https_proxy` / `no_proxy`, with full `NO_PROXY` semantics (`*`, domain suffixes, port qualifiers, IPv6). `undici` is imported only when a proxy is actually configured.

A new `network` config block can override the environment: `proxy: 'off'` forces direct connections, and a URL pins a proxy the user cannot route around by clearing their shell profile. `network.noProxy` merges with the environment's rules rather than replacing them.

`moxxy doctor` reports the effective proxy (credentials masked) and warns when a proxy is in use without `NODE_EXTRA_CA_CERTS`, which is the usual cause of `UNABLE_TO_VERIFY_LEAF_SIGNATURE` behind a TLS-terminating proxy.
