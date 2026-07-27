---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

Make the secret store a swappable block.

The built-in vault (AES-256-GCM, OS-keychain unlocked) is a good design for one machine and unusable for a fleet: no central issuance, no rotation, no way to revoke a single workstation. Every organisation already runs something that does those three things.

`SecretProvider` is a new registry-backed block. The vault is registered by the host as the protected floor, so an external store (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, 1Password) sits above it and resolution falls back to the vault for anything the provider does not hold. That makes adoption incremental: point `plugins.secretProvider.default` at a store and move secrets over one at a time.

A provider that throws is not treated as a miss. An unreachable store or an expired token surfaces as a failure, because silently falling through to the local vault would mean a machine running on credentials the operator believes they revoked.

Deliberately one block, not two: a host-scoped credential is a named secret with a naming convention on top, so a separate `CredentialProvider` registry would be a second overlapping abstraction to keep in sync.

Known limitation: `${vault:KEY}` placeholders in config still resolve against the local vault, because config is loaded before plugins register. Tool-facing `ctx.getSecret(name)` goes through the active provider.
