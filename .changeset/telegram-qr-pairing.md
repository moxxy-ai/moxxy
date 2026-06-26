---
'@moxxy/sdk': minor
'@moxxy/cli': minor
'@moxxy/desktop': minor
---

Telegram chat pairing now works from the desktop, via a single QR mechanism used everywhere.

Previously, starting Telegram from the desktop Channels panel errored with "No Telegram chat is paired yet" — the channel refused to start unpaired and the only pairing path was the TTY-only paste-a-code flow. Now, when unpaired, Telegram opens a host-issued pairing window: it mints a one-time code, publishes a `t.me/<bot>?start=<code>` deep link as its connect value, and the panel renders it as a QR. The user scans → taps **START** in Telegram (or sends the 6 digits) and the chat pairs — zero typing — after which the panel shows "✓ Connected".

This is the **single** pairing mechanism everywhere: `moxxy channels telegram pair` now renders the same QR in the terminal (and waits for the scan) instead of the old bot-DMs-a-code / paste-in-the-terminal flow, which is removed.

New SDK surface: `Channel.connected` and `ChannelHandle.onConnectChange`, plus a `connected` field on the channel status file, so a dedicated-runner host can swap the QR for "Connected" live.
