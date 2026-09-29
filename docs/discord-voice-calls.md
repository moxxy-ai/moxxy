# Discord voice calls

The Discord bot can talk with you in a voice channel, turn by turn: you speak,
the agent answers, and the answer is read aloud. You can interrupt it.

## Starting and ending a call

- **You call the bot:** send `/call` (in DMs or an allow-listed channel). If you
  are already in a voice channel on a server you share with the bot, it joins
  you. Otherwise it waits in the first voice channel it may join on such a
  server and DMs you a link.
- **The agent calls you:** the `discord_call` tool does the same and says why
  it called as soon as you are in the channel. It needs your approval unless
  auto-approve is on, and it works from the bot's own conversation (Discord, or
  Channels → Discord in the app).
- **Ending:** `/hangup`, or leave the voice channel. A call nobody joins ends
  after two minutes with a "Missed call" DM.

## During a call

- The bot listens only to you (the paired account); others in the channel are
  ignored.
- An utterance ends after about 1.2 s of silence. What it heard is posted to
  your DMs as `heard: …`, and the agent's reply appears there as text too.
- Replies are spoken with the active voice (Settings → Voice) and kept short
  and speakable.
- **Interrupting:** talk over a reply for a moment and the bot stops speaking
  and listens. As in the desktop's Voice Mode, this stops only the speech; the
  agent's work goes on. Things you say while the agent works are answered in
  order.

## Requirements

- The bot needs the **Connect** and **Speak** permissions in the voice channel.
  The invite link includes them; a bot invited earlier needs them granted in
  the server settings (or a fresh invite).
- A speech-to-text backend (e.g. `moxxy login openai-codex`) and a voice
  (Settings → Voice). Reading replies aloud uses ffmpeg to encode Opus.
- Node.js 22.12 or newer (the Discord voice library requires it; the rest of
  the bot runs on older versions).
