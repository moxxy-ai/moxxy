---
'@moxxy/cli': minor
'@moxxy/sdk': minor
---

Authenticate to an internal plugin registry.

The install-policy work let an operator point at an internal mirror, but gave no way to authenticate to it, so a mirror behind SSO was unreachable. `hostCredentialName()` derives a canonical secret name from a host (`registry.example.internal` becomes `MOXXY_CREDENTIAL_REGISTRY_EXAMPLE_INTERNAL`), and the registry fetch sends it as a bearer token on both the index and its signature.

The credential is resolved through whatever `SecretProvider` the machine has active, which is why there is no separate credential registry: a host credential is a named secret plus a convention, so the store an organisation already plugged in serves these too.

Authentication decides only whether the index is reachable. The Ed25519 verification is unchanged and still decides whether the bytes are trusted, so an authenticated mirror serving an unsigned index is refused exactly like an anonymous one.

`Session.resolveSecret` exposes the same resolver tool handlers get, so host-side callers go through the active provider instead of reaching past it to the local vault.
