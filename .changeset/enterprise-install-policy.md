---
'@moxxy/cli': minor
---

Add an install policy and a config-pinned plugin registry.

`moxxy plugins install` ran `npm install` against whatever spec it was given: a bare name, `name@version`, a git URL, or a filesystem path. On a personal machine that is the point. On a managed fleet it meant the supply chain had no boundary, and an organisation had no way to draw one.

`plugins.installPolicy` takes `open` (the default, unchanged behaviour), `registry-only` (accept only packages the signed Ed25519 index vouches for, which also pins an exact version), or `denied` (nothing installs at runtime, for an image built once and shipped).

It is enforced inside the install function rather than at the CLI surface, because the `install_plugin` model tool reaches the same path. A policy the agent could route around by asking itself would not be a policy.

`plugins.registryUrl` moves the index location into config so the system scope can pin an internal mirror. It was previously reachable only through `MOXXY_REGISTRY_URL`, a variable a user can unset, which makes it useless as a control. Whatever the URL serves must still verify against the key baked into the CLI, so this is a source decision, not a trust decision.

The enterprise profile now sets `registry-only` and locks it.
