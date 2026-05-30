---
"@moxxy/cli": patch
---

`moxxy init`: collect the vault passphrase as a styled first step instead of a bare prompt.

On a first run the vault needs a passphrase to derive its encryption key. Previously this fired as an unstyled `readline` prompt *before* the wizard (and before the logo). It's now a `@clack/prompts` `password` step — rendered under the moxxy logo, with a short description — so it reads as the first pre-requirement step of setup, consistent with the rest of the wizard. Threaded via a new `SetupOptions.passphrasePrompt`; headless `init` is unaffected (still uses `MOXXY_VAULT_PASSPHRASE` / the non-TTY guard).
