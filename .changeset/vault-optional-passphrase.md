---
'@moxxy/cli': minor
---

Stop demanding a vault passphrase on first run.

The master key was resolved from `MOXXY_VAULT_PASSPHRASE`, then the OS keychain, then a cached key at `~/.moxxy/vault.key`, and finally an interactive passphrase prompt. On macOS the keychain means nobody is ever asked, but on a host without one, a container, a headless Linux box, CI, that prompt was the last resort and a hard stop on a non-TTY.

A randomly generated 256-bit key now sits between the disk cache and the prompt. It gives the same protection against what this vault is actually for, which is a key leaking through config committed to git, a transcript, or a log. It does not protect against someone who can already read a `0600` file in the user's home; an OS keychain or a passphrase does raise that bar, and `moxxy doctor` now says so when a generated or file-backed key is in use.

Generation only happens when the key can be **persisted**. A generated key that could not be stored is unrecoverable, so every secret written under it would be lost on the next run; there the prompt is better precisely because the user can reproduce it from memory.

`vault.requirePassphrase: true` restores the old behaviour, and an operator can lock it from the system scope.
