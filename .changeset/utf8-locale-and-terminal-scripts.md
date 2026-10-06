---
'@moxxy/sdk': minor
'@moxxy/cli': patch
---

Commands the agent runs get a UTF-8 character type when the environment sets none, so `pbcopy` keeps Polish letters instead of writing mojibake ("pamińôńá" for "pamięć"); the SDK exports `utf8Locale`. The shared terminal sources a long or multi-line command from a private temporary file instead of typing it in, so a heredoc script no longer leaves the shell at `heredoc>`, and a shell still waiting for the rest of a command when the timeout comes gets Ctrl-C and says so.
