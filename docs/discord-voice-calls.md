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
  and speakable. The bot starts talking as soon as the agent has written its
  first sentence, and voices the next two while one plays — the same sentence
  splitting as the desktop's Voice Mode.
- **While the agent works** you are not left in silence: the agent is asked to
  say in one short sentence what it is about to do and, before each further
  step, what it is checking now. If it starts a step without a word, the bot
  names the kind of step itself ("Przeglądam pliki.", "Sprawdzam, czy wszystko
  działa.", "Szukam w internecie."), and during a long step it says it is still
  at it (after 10 s, 40 s, then every 90 s). It never repeats itself within 8 s
  of speaking and never reads out commands or paths. This is the desktop's
  Voice Mode feedback (shared in `@moxxy/chat-model`) with the step names on.
- **Interrupting:** talk over a reply for a moment and the bot stops speaking,
  skips the rest of what it was saying, and listens. This stops only the
  speech: the agent's work goes on, and what it says next — the next step, and
  its result at the end — is still said. Things you say while the agent works
  are answered in order.
- **When a sentence cannot be voiced** (for example the text-to-speech service
  refused it), the bot skips it and logs the reason as
  `discord call: a sentence could not be voiced`.

## Requirements

- The bot needs the **Connect** and **Speak** permissions in the voice channel.
  The invite link includes them; a bot invited earlier needs them granted in
  the server settings (or a fresh invite).
- A speech-to-text backend (e.g. `moxxy login openai-codex`) and a voice
  (Settings → Voice). Reading replies aloud uses ffmpeg to encode Opus.
- Node.js 22.12 or newer (the Discord voice library requires it; the rest of
  the bot runs on older versions).
