---
'@moxxy/cli': minor
---

Add the headless provisioner foundation for Pillar 3 (slim-core / on-demand setup): a shared `provision()` engine + a `moxxy provision` command + a first-party provider catalog.

`provision({ provider, model, key, basics })` resolves the provider from the catalog, installs its package (skipping it when it's already registered — i.e. bundled — so it never duplicate-registers), installs accepted basics, stores the key in the vault, and writes the unified `plugins:` config — config last, so a mid-flight failure leaves no half-state. `moxxy provision` drives it headlessly via flags (`--provider anthropic --key … --model …`) or a JSON spec on stdin (`--spec -`) — the same engine the interactive `init` wizard + the desktop first-run will use.

Safe + additive: providers stay bundled, `init` is unchanged. Includes `pinFirstPartySpec` (pins first-party installs to the CLI version, scoped to provision so it can't break the generic `install_plugin` path) and the `PROVIDER_CATALOG` (slug → package + auth + default model). Rewiring `init` + the actual unbundling/publishing are the gated follow-ups.
