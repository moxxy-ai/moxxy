---
name: vault-setup
description: Help the user store secrets in the encrypted vault with Env Share, without the secret ever reaching the model.
triggers: ["set up vault", "initialize vault", "store a secret", "save api key", "need an api key", "provide your key"]
allowed-tools: [env_share, vault_status, vault_list]
---
# Vault setup

The user wants to store secrets (API keys, tokens, webhook URLs) in moxxy's encrypted vault.

## The golden rule: never handle the plaintext yourself

**Never ask the user to paste a secret into the chat, and never call a tool with a secret value the user gave you.** Anything the user types to you, and any tool argument you send, is visible to you (the model) and is recorded in the conversation. Secrets must not flow through there.

Call `env_share` with the environment variable name and why the integration needs it. The user can save or skip the request in the desktop or TUI. Continue with the returned `${vault:NAME}` reference after a successful save. If the request is skipped, stop the step that needs it.

For a headless session the person can run `moxxy env share NAME` in a local terminal. The command asks privately for the value. Check entry names with `vault_list` before continuing.

## Using a stored secret

- In `moxxy.config.ts` / `moxxy.config.yaml`: write `${vault:OPENAI_API_KEY}` anywhere a string is expected. The CLI resolves it on session start.
- **From plugin/tool code that needs the value at call time:** read it with `const key = await ctx.getSecret('OPENAI_API_KEY')` (the `ToolContext` passed to every tool handler). The plaintext goes straight to your handler — it never enters the model's context or `process.env`. This is the way an authored plugin should consume an API key; do **not** read `process.env`, and do not fetch-and-inline the plaintext anywhere the model can see it.

## Where things live

`~/.moxxy/vault.json` — AES-256-GCM ciphertext per entry. The master key comes from the OS keychain (macOS Keychain / libsecret / Windows Credential Manager) when available, otherwise a passphrase prompt; on headless systems set `MOXXY_VAULT_PASSPHRASE`. The first vault use triggers the unlock.

## Verify

Call `vault_list` (names + metadata only, never plaintext) or have the user run `/vault list` to confirm the entry is present.
