# GPT-Live Voice Mode

Voice Mode in the desktop app has two engines, picked in
**Settings → Preferences → Voice**:

| Engine | How a turn works | Can act in the app |
|---|---|---|
| **Local** (default) | Your speech is transcribed, answered by the Moxxy agent, and read aloud by Local Piper. | Yes — every utterance is an agent turn. |
| **GPT-Live** | A full-duplex call with OpenAI's GPT-Live over your existing ChatGPT login. GPT-Live listens and talks with you itself. | Yes, on explicit request — your own words run as an agent turn and GPT-Live reads back the real result. |

GPT-Live reuses the ChatGPT OAuth login from `moxxy login openai-codex` (the
same login the Codex provider and Codex transcription use). No API key is
involved. Calls draw on your ChatGPT voice allowance.

## How a GPT-Live call behaves

- **Knows the chat.** When a call opens, the last messages of the workspace
  conversation (up to 128 items / ~8,192 tokens) are handed to GPT-Live. While
  the call is open, anything typed in the chat or answered by the agent is
  forwarded as silent context.
- **Talks by itself.** Questions, chat and anything it can answer from the
  conversation are answered by GPT-Live directly. Those exchanges are recorded
  into the chat as ordinary turns (visible, persisted, and context for later
  agent turns). Speech it never answered is recorded when the call closes.
  Conversation spoken while the agent is working is held by the runner and
  appears after that turn ends as **one collapsed "Voice conversation" block**
  (expand it to read the transcript), so it never lands in the middle of the
  agent's task (the agent re-reads the whole log before every model call).
  Later agent turns see it as context, not as a request.
- **Hands explicit tasks to the agent — in your words.** When you explicitly
  ask Moxxy to do, run, create, change, check or find something, GPT-Live
  delegates. Moxxy does not use GPT-Live's paraphrase: it takes the final
  transcript of *your* turn (matched by `user_bidi_turn_id`) and sends it to the
  chat as one ordinary agent turn, exactly as if you had typed it.
- **Reports only real results.** GPT-Live says a short acknowledgement and then
  waits. When that agent turn completes, its final reply — or its failure — is
  handed back and GPT-Live reads it out. It is instructed never to claim the
  work is done before the result arrives. If the agent stops for an approval,
  the rail shows "Needs your input" and GPT-Live is told to point you to it.
- **Knows what the agent is doing.** While a task runs, each change in the
  agent's activity (reading the project, running tests, editing files, …) is
  sent to GPT-Live as silent context, and the same operations show on the
  Voice Mode rail. "How is it going?" is answered by GPT-Live itself instead of
  becoming another task.
- **One task at a time; voice never feeds the chat queue.** If you ask for a
  new task while the agent is busy (with a voice task, or with something typed
  that is running or queued), it is **not started** and never runs later: the
  agent finishes what it is doing. GPT-Live tells you so (or, if the request
  was really a question, answers it itself), and the request stays in the chat
  as a "Not started" note. Typed messages keep queueing exactly as before, and
  the Local engine is unchanged.
- **Never talks over itself.** Anything appended to the call while GPT-Live is
  speaking cuts its answer off mid-sentence, and it then only remembers the
  part it got to say. Progress, chat context and task results therefore wait
  until its current spoken turn ends.
- **No duplicates.** A delegated request appears in the chat once, as the
  agent turn; acknowledgements and read-back results are not recorded again.

## Architecture

```
renderer: apps/desktop/src/voice-call/gpt-live/
  useGptLiveVoiceCall      the call (implements UseVoiceCall)
  gpt-live-transport       WebRTC peer, microphone, `oai-events` data channel
  gpt-live-protocol        parse server events, build client events
  gpt-live-exchange        pair finished turns into recorded exchanges
  gpt-live-delegation      delegation → agent turn → result; progress; busy refusal
  gpt-live-chat-context    forward new chat messages as silent context
  gpt-live-outbox          hold outbound context while GPT-Live is speaking

main process: packages/desktop-host/src/ipc/
  voice.live.preflight     is there a ChatGPT login?
  voice.live.start         runner history + host instructions → GptLiveCallClient
  session.recordVoiceExchange → RemoteSession.recordExchange (runner v16)

GptLiveCallClient (packages/plugin-provider-openai-codex/src/live/)
  POST chatgpt.com/backend-api/codex/realtime/calls  ← SDP offer, OAuth bearer
```

- The bearer token, endpoint, model, instructions and chat history never leave
  the main process. The renderer only sends its WebRTC offer and receives the
  SDP answer.
- `voice.live.*` and `session.recordVoiceExchange` are **not** on the remote
  (mobile / WS bridge) allow-list.
- The runner method `session.recordExchange` (protocol **v16**) appends
  `user_prompt` + `assistant_message` under one new turn id without running a
  model or tools. While a turn is running exchanges are held
  (`packages/runner/src/spoken-exchanges.ts`) and appended once no turn runs —
  before that turn's `turn.complete` — as one `user_prompt` transcript with
  `origin: { kind: 'voice' }`, which the desktop and TUI render as a collapsed
  marker (like webhook / schedule prompts). Older runners reject it with an "update the CLI" error, and
  Voice Mode stops rather than silently losing the conversation.
- Delegated tasks go through the normal chat send path (`chat.send`), so they
  queue, stream, ask for permissions and persist like any typed prompt. The
  result is correlated by the agent turn's `user_prompt` and delivered on
  `runner.turn.complete`.
- `useDesktopVoiceCall` picks the engine; the Voice Mode rail, Focus mirror and
  capture lease are shared with the local engine unchanged.

## Wire contract

GPT-Live is only reachable with a ChatGPT login through the Codex realtime
route (the public `/v1/live/sessions` API requires an API key). It is an
undocumented preview contract. Verified against the live service on
2026-09-28:

- `POST https://chatgpt.com/backend-api/codex/realtime/calls?intent=quicksilver&architecture=avas`
  with headers `Authorization: Bearer …`, `ChatGPT-Account-Id`,
  `openai-alpha: quicksilver=v2`, `originator: codex_cli_rs`, `x-session-id`
  and body `{ sdp, session: { instructions, model: "gpt-live-1-codex",
  audio: { output: { voice } }, delegation: { type: "client" }, initial_items } }`.
  Returns `201` with the SDP answer and `Location: …/rtc_…`.
  The model id is enforced: the earlier `gpt-live-1-boulder-alpha` now fails
  with `400 session.model is not allowed`.
- Server events on the `oai-events` data channel: `session.started`,
  `input_transcript.added` / `output_transcript.added` (`item.text`),
  `turn.created`, `turn.delta`, `turn.done` (`turn.role`, `turn.transcript`),
  `delegation.created` (`item.id`, `item.user_bidi_turn_id`; usually arrives
  before the user turn's `turn.done`), `delegation.context.appended`,
  `session.usage.updated`, `session.closed`, `error`.
- Client events accepted: `session.update`, `session.context.append`
  (channels `speakable`, `commentary`, `developer`), `delegation.context.append`,
  `input_audio.pause` / `resume`, `response.create`, `session.close`, and a few
  others. `session.context.append` without a channel is treated as user text
  and answered aloud; the `developer` channel adds context silently.
- A task result goes back as `delegation.context.append` with the delegation
  `item.id` and `channel: "speakable"`, chunked to 500 bytes; GPT-Live then
  speaks it. An interim status on `channel: "commentary"` leaves the
  delegation open; its speakable result can follow much later (Voice Mode does
  not use it).
- Any `session.context.append` sent while an assistant turn is being spoken
  interrupts it: the turn ends early with `turn.done` carrying only the words
  already spoken, and the model does not resume. Sent before the reply starts,
  it does not interrupt. (Verified 2026-09-29.)

## Risks

- The route is private and has changed before (model id, a `403 Voice session
  access denied` wave in September 2026). Every wire detail lives in
  `packages/plugin-provider-openai-codex/src/live/gpt-live-call.ts` and
  `apps/desktop/src/voice-call/gpt-live/gpt-live-protocol.ts`.
- Whether a request counts as a task is GPT-Live's call, steered by the host
  instructions in `packages/desktop-host/src/ipc/voice.ts`. What runs is always
  the user's own transcript, never the model's paraphrase.
- Sometimes a call is accepted (`201` with an SDP answer) but its media server
  never answers ICE checks, so the call cannot open; a call a few minutes later
  works (seen 2026-09-29). Voice Mode then stops with "Couldn't reach the
  GPT-Live voice server" after 30 seconds.
- Only the WebRTC transport works with a ChatGPT login, so GPT-Live is desktop
  only.
- OpenAI's terms say nothing explicit about third-party clients using the
  ChatGPT login for voice.

## Verifying

```bash
pnpm --filter @moxxy/runner exec vitest run src/integration.test.ts -t recordExchange
pnpm --filter @moxxy/plugin-provider-openai-codex exec vitest run src/live
pnpm --filter @moxxy/desktop-host exec vitest run src/ipc/voice-live.test.ts
pnpm --filter @moxxy/desktop exec vitest run src/voice-call
```

Manual smoke: sign in with `moxxy login openai-codex`, pick **GPT-Live** in
Settings, open Voice Mode, ask about something earlier in the chat, then ask it
to do something ("run the tests in this project"). The request should appear in
the chat as your own words, the agent should run it, and GPT-Live should read
back the agent's actual reply only after the turn finishes.
