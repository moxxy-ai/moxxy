---
title: '@moxxy/plugin-vault'
description: AES-256-GCM encrypted secret store + `${vault:KEY}` placeholders.
---

`@moxxy/plugin-vault` stores secrets at `~/.moxxy/vault.json`, encrypted
with AES-256-GCM via a key derived from the user's passphrase. It also
resolves `${vault:NAME}` placeholders in `moxxy.config.ts` so configs
stay free of plaintext keys.

## Install

```sh
pnpm add @moxxy/plugin-vault
```

## Build

```ts
import { buildVaultPlugin } from '@moxxy/plugin-vault';

const { plugin, vault } = buildVaultPlugin({
  // filePath: '~/.moxxy/vault.json' (default)
  // envVar: 'MOXXY_VAULT_PASSPHRASE'
});
session.pluginHost.registerStatic(plugin);
```

## Env Share

When an integration needs a credential, Moxxy opens a masked field with the entry name and purpose. Choose **Save to vault** to create or replace the entry, or **Skip** to close the request. The conversation receives the outcome and the agent can use the reference, for example `${vault:GITHUB_TOKEN}` in an MCP server environment.

You can also start a private entry yourself.

- In desktop, open **Settings → Vault → Env Share**.
- In the TUI, type `/env share GITHUB_TOKEN`.
- In a terminal, run `moxxy env share GITHUB_TOKEN` and enter the value at the prompt.

## Tools

| Tool | Permission | Purpose |
|---|---|---|
| `env_share` | person enters or skips | Request a credential by name and purpose. |
| `vault_set` | prompt | Store a secret. Overwrites if name exists. |
| `vault_get` | prompt | Fetch a legacy entry by name. Env Share entries allow integration use by reference only. |
| `vault_list` | prompt | List names + metadata, never plaintext. |
| `vault_delete` | prompt | Delete by name. |
| `vault_status` | auto | Report which key source unlocked the vault. |

## Placeholder resolution

```ts
provider: {
  name: 'anthropic',
  config: { apiKey: '${vault:ANTHROPIC_API_KEY}' },
}
```

`resolveString(input, vault)` and `resolveValue(value, vault)` walk
arbitrary values and substitute every `${vault:NAME}` they find. The
CLI's setup runs this on the loaded config before handing it to plugins.

## Key sources

`createCombinedKeySource(...)` resolves the master key in priority:

1. `MOXXY_VAULT_PASSPHRASE` env var (derive each call, no persistence).
2. OS keychain via `keytar`.
3. On-disk cached key at `~/.moxxy/vault.key` (mode `0600`).
4. Interactive passphrase prompt.

The first successful prompt persists to both keytar (if available) and
disk so the next run doesn't re-prompt.

## Exports

- `VaultStore`, `VaultPassphraseError`
- `createCombinedKeySource`, `createStaticKeySource`
- `resolveString`, `resolveValue`, `containsPlaceholder`
- `deriveKey`, `encrypt`, `decrypt`, `generateSalt`, `randomCode`
- `defaultVaultPath()` → `~/.moxxy/vault.json`
