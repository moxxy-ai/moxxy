---
name: swap-plugin-default
description: Swap, install, enable, or replace a default block (provider, mode, compactor, embedder, eventStore, …) when the user wants to change which implementation is active.
triggers:
  - swap the
  - replace the default
  - change the default
  - use a different
  - switch to
  - set default
  - make the default
  - install and use
  - enable the
  - disable the
  - which provider
  - change provider
  - change mode
  - change compactor
  - change embedder
allowed-tools:
  - list_defaults
  - set_default
  - install_plugin
  - enable_plugin
  - disable_plugin
---

moxxy's config is a unified `plugins:` manifest with two axes:

- **`plugins.packages.<pkg>.enabled`** — whether a package (and all its contributions) is installed/on.
- **`plugins.<category>.default`** — which registered contribution is *active* for a category (provider, mode, compactor, cacheStrategy, embedder, transcriber, synthesizer, workflowExecutor, viewRenderer, tunnelProvider, isolator, eventStore, channel).

Every category has a **protected floor**: you can swap the active default to any other *registered* contribution, but the floor can never be removed, and kernel packages can never be disabled. A default that names something not installed falls back to the floor — so always make sure the target is registered before (or as part of) swapping.

When the user wants to change which implementation is active, follow this flow:

1. **See what's there.** Call `list_defaults` to get every category with its active default and the available swappable contributions. Match the user's intent to a `{ category, name }` — `name` is the *contribution* name (e.g. provider `openai`, mode `goal`, eventStore `sqlite`), not the package name.

2. **If the target contribution is already registered** (it shows up in `list_defaults` for that category): just `set_default { category, name }`. Done — it persists to `~/.moxxy/config.yaml` and applies to the running session immediately.

3. **If the target isn't registered yet** (the user named something not in the list, e.g. "use the Gemini provider" but no Gemini contribution exists):
   - If a *disabled* package would provide it, `enable_plugin { packageName }` to plug it back in, then re-check `list_defaults`.
   - Otherwise `install_plugin { packageName }` to fetch the package that provides it (ask the user / infer the `@moxxy/plugin-*` name; the install hot-reloads so its contributions register), then re-check `list_defaults`.
   - Once the contribution appears, `set_default { category, name }` to make it the active default.

4. **Replacing = install/enable + set_default in one go.** "Replace the default compactor with X" means: ensure X's package is installed+enabled, then `set_default compactor X`. Confirm the swap to the user with the new active value.

Notes:
- `set_default`, `install_plugin`, `enable_plugin`, `disable_plugin` are permission-gated — the user is prompted before each change.
- Disabling a kernel/core package (cli, tools-builtin, mode-default, plugins-admin, config, vault, the context-lifecycle defaults) is refused — tell the user to swap that category's default instead of disabling the package.
- Swapping the `eventStore` default activates a third-party storage backend that sees every event; only do it on the user's explicit request.
