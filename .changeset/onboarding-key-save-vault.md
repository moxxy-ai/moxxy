---
'@moxxy/desktop-host': patch
---

Saving an API key on the first-run "Connect a provider" step works again. It used to hand the key to `moxxy vault set`, a command the CLI does not have, so every API-key provider (Anthropic, OpenAI, …) failed with "unknown command: vault"; the key now goes straight into the vault the runner reads, as Settings → Vault already did. Listing a stored vendor's models in Settings had the same fault (`moxxy vault get`) and now reads its key from that vault too.
