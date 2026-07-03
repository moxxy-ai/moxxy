---
'@moxxy/plugin-channel-whatsapp': minor
'@moxxy/sdk': minor
'@moxxy/cli': minor
---

Add a WhatsApp channel via Baileys (`@moxxy/plugin-channel-whatsapp`): QR device-link pairing, a mandatory typed consent gate for the unofficial-API/ban risk, JID allow-list (owner Note-to-Self allowed by default), fromMe-echo loop protection, voice-note transcription, and send-then-edit streaming over a swappable auth-state backend. Runs on its own dedicated isolated runner (`sessionSource: 'whatsapp'`, added to the SDK `SessionSource` union).
