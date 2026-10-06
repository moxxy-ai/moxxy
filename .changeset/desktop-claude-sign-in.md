---
'@moxxy/desktop': patch
---

Offer the Claude Pro/Max sign-in (`claude-code`) in the desktop. The desktop now ships the provider with its bundled extensions and lists it in onboarding and Settings → Providers, as the CLI's `moxxy init` already did. Packaging now fails if the provider is missing.
