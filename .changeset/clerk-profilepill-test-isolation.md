---
---

Test-only: make the desktop ProfilePill "no publishable key" test deterministic
(stub `VITE_CLERK_PUBLISHABLE_KEY` empty + re-import) so a developer's local
`apps/desktop/.env` no longer fails it. No runtime change.
