---
'@moxxy/plugin-plugins-admin': minor
'@moxxy/cli': patch
---

Signed plugin-registry v1, client side: Ed25519-verified `index.json` fetch with a re-verified 1h cache at `~/.moxxy/registry-cache.json` and hardcoded-catalog fallback on any failure (never throws into the install path). Catalog installs that resolve through a signed entry install the signature-covered exact version (pin precedence: user `--version` > signed index > cliVersion lockstep > latest), and `install_plugin` warns when the registered capability surface is wider than the signed manifest. Dormant until a maintainer key is baked into `REGISTRY_PUBLIC_KEY` (empty = disabled, exactly like the desktop update key).
