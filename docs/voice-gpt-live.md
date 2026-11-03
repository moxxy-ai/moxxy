# Voice in the desktop

Settings → Voice has three sections: **Conversation**, **Read aloud** and
**Transcription**. One `OPENAI_API_KEY` vault entry is shared by the OpenAI model
connection, GPT-Live, OpenAI transcription and OpenAI TTS. The key field only
reports whether a key exists; it never reads the secret back into the window.
There is no paid-use confirmation dialog. The key card explains API billing.

| Conversation engine | Behaviour |
| --- | --- |
| Classic (shown as Local) | Transcription → the Moxxy agent → read aloud. Local dictation and Supertonic can work offline. |
| GPT-Live | OpenAI's `gpt-live-1` holds the conversation over WebRTC. Explicit tasks run through the Moxxy agent. Requires an OpenAI API key. |

Read aloud offers Gemini Flash-Lite and Supertonic 3. New Gemini
Live, Gemini transcription and further Gemini TTS work are deferred.

## Official OpenAI connection

`GptLiveSessionClient` in `packages/plugin-provider-openai/src/live/` uses the
installed OpenAI SDK's `client.live.create` (`POST /v1/live/sessions`). The main
process sends the API key, model, instructions, history and browser SDP offer;
the renderer receives only the SDP answer and session ID. Audio and the
`oai-events` data channel then flow over WebRTC. The API key stays in the main
process. This public Live API accepts the server-side SDP exchange directly;
no ephemeral credential is sent to the browser.

```json
{
  "session": {
    "model": "gpt-live-1",
    "instructions": "…",
    "delegation": { "type": "client" },
    "input": [{ "role": "user", "type": "message", "content": [{ "type": "input_text", "text": "…" }] }]
  },
  "transport": { "type": "webrtc", "sdp": "v=0…" }
}
```

The service returns `session.id` and `transport.sdp`. The data-channel reader
handles `session.started`, `session.input_transcript.delta`,
`session.output_transcript.delta`, `session.delegation.created`, `session.closed`
and errors. Live streams transcript fragments rather than discrete turns; the
reader finishes an utterance when the speaker changes, a delegation arrives,
the call ends or the assistant is quiet for 1.5 seconds.

See OpenAI's [WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live),
[session guide](https://developers.openai.com/api/docs/guides/live-conversations)
and [client delegation](https://developers.openai.com/api/docs/guides/live-delegation).

## Conversation and tasks

- Recent chat messages (up to 128 items and roughly 8,192 tokens) seed the call.
  New typed messages and agent answers reach it as silent context.
- Questions are answered by the voice model. Only explicit tasks are delegated.
  Moxxy dispatches the user's transcript verbatim, through normal chat send,
  permissions and persistence. It never executes a model's rewritten prompt.
- A delegation waits for the agent's real final answer or error before reading
  the result aloud. A busy agent refuses a second task; voice never queues it.
- Recorded voice exchanges use the runner's `session.recordExchange`. They are
  context rather than new requests and do not get mirrored back into the call.
- Context and results wait in an outbox while the voice model speaks.

## Progress

The status projection reads the same runner events as the chat: user prompt,
tool requests and results, step lists, and turn completion. It follows tasks
started in chat as well as voice. A call opened mid-task restores that task
from the chat's current event window. Progress includes elapsed time, command,
file basename or host, completed activity categories and plan progress. Input
requests tell the person to approve or answer in the chat. Tool results and file
contents never enter the progress summary; common key and credential arguments
are redacted from command descriptions.

Changes in activity send `session.thinking.append`; starting a user utterance
refreshes the status and elapsed time. Official Live **client delegation does
not expose a custom function directly to the voice model**. Status therefore
arrives as on-demand context, rather than a fictional `get_agent_status` tool.
The model is instructed to answer progress questions without starting a task.
`session.commentary.append` carries the finished delegation result.

## Transcription and migration

The microphone's OpenAI path uses `gpt-transcribe` through the official audio
transcriptions API. It resolves the shared vault key for each recording, so a
newly saved or replaced key works without restarting. Without a key or a local
transcriber, it asks the person to choose transcription and configure a key.
There is no ChatGPT-token fallback.

The retired ChatGPT-token provider and transcriber packages are no longer loaded,
even if an old installation left them on disk. A configuration or saved chat
that selected the retired provider moves to `codex-agent` when it is available
and authenticated. Old backend configuration and model IDs are not reused.
Without a working Codex connection, the desktop opens provider recovery and
explains how to connect Codex, add an OpenAI API key, or choose another connection.
A successful automatic move shows a notice. Old vault tokens are not used.

First-run provider provisioning waits for the same plugin preparation as runner
startup and provider login, so saving a key cannot race the initial installation.

## Verification

```sh
pnpm --filter @moxxy/plugin-provider-openai test
pnpm --filter @moxxy/desktop-host test
pnpm --filter @moxxy/desktop exec vitest run src/voice-call src/settings src/onboarding
pnpm build
```

Use an isolated home for API and desktop smokes. Manual microphone testing should
cover conversation, exact task wording, results, progress questions, approval,
interruption and reconnect. `pnpm test:agents:live` is required before merging.
