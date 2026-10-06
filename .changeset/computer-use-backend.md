---
'@moxxy/cli': patch
---

Computer Use: add the shared backend the new macOS and Windows helpers will run behind — one helper per session turn with the existing Stop/Pause controls, the Codex/Claude-style tools built from the shared contract, per-app access levels (browsers and trading apps read-only, terminals and IDEs click-only, everything else full, with `full_access` for apps the user approves), system and clipboard chords gated by their grants, and grants read back from the session log so every attached client sees the same access. Helper refusals now keep their error code. Nothing is wired to the running tools yet.
