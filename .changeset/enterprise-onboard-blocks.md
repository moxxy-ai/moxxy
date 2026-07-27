---
'@moxxy/cli': patch
---

Surface the swappable blocks during onboarding, and make the audit sink swappable.

Everything in moxxy is a swappable block: the loop, the compactor, the cache strategy, the isolator, the event store, the audit sink. `moxxy plugins defaults` has always exposed that, but onboarding never mentioned it, so a user could finish setup without learning the central idea and would then reach for config files to change something the swap axis already owns.

Onboarding now shows what each block resolves to, and offers a swap only for categories that genuinely have an alternative. On a fresh install most hold exactly one registration, and asking "which compactor?" when there is one compactor teaches the user that the wizard wastes their time.

The `auditSink` registry added with the audit trail was missing from the category-swap surface, so the one block introduced as swappable was the one block you could not swap. It now appears in `moxxy plugins defaults` alongside the rest.
