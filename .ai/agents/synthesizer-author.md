---
name: synthesizer-author
description: Build a text-to-speech Synthesizer plugin (ElevenLabs / OpenAI TTS / local engine / ...).
---

# Synthesizer author — implement a `Synthesizer` (text-to-speech)

A Synthesizer is the symmetric counterpart to a `Transcriber`: it turns text into spoken audio. Read-aloud surfaces — the desktop's speaker button, a future voice channel — call `session.synthesizers.tryGetActive()?.synthesize(text)` and play the bytes. When no synthesizer is active the caller falls back to the OS voice (`speechSynthesis`), so adding one is purely additive — you never break the no-TTS default.

The SDK contract (`@moxxy/sdk`):

```ts
interface Synthesizer {
  readonly name: string;                               // short, stable, e.g. 'elevenlabs'
  synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesisResult>;
}

interface SynthesisResult {
  readonly audio: Uint8Array;   // encoded bytes ready to play (mp3 / wav / ogg)
  readonly mimeType: string;    // e.g. 'audio/mpeg', 'audio/wav', 'audio/ogg'
}

interface SynthesizeOptions {
  readonly voice?: string;      // voice id/name when the backend supports selection
  readonly language?: string;   // BCP-47 hint, e.g. 'en', 'pl'
  readonly rate?: number;       // speaking-rate multiplier (1.0 = normal)
  readonly signal?: AbortSignal;
}
```

There is **no shipped synthesizer plugin yet** — TTS is wired end-to-end (the SDK type, `SynthesizerRegistry`, the desktop `session.synthesize` IPC, the `set_voice`/`list_voices` admin tools) but ships with zero backends, so the OS voice is the default. You are writing the first one. The `Transcriber` siblings — `@moxxy/plugin-stt-whisper` and `@moxxy/plugin-stt-whisper-codex` — are the closest reference for the HTTP + auth shape.

## The `SynthesizerDef` + `create(ctx)` factory

A plugin contributes `SynthesizerDef`s via `PluginSpec.synthesizers`. Note the asymmetry with `TranscriberDef`: a transcriber's factory is `createClient(config)`, but a synthesizer's is `create(ctx)` and receives a `SynthesizerCreateContext`:

```ts
interface SynthesizerCreateContext {
  readonly config: Record<string, unknown>;                       // from setActive(name, config)
  readonly getSecret?: (name: string) => Promise<string | null>;  // vault-backed
}
```

**Read your API key via `ctx.getSecret`, never `process.env`.** It's the same vault-backed resolver wired into tool contexts, so the key never enters the model's context. Resolve it lazily (inside `synthesize`, cached) so `create` stays cheap and synchronous.

```ts
import {
  defineSynthesizer,
  definePlugin,
  classifyHttpStatus,
  classifyNetworkError,
  MoxxyError,
  type Synthesizer,
  type SynthesizerCreateContext,
  type SynthesizeOptions,
  type SynthesisResult,
} from '@moxxy/sdk';

const ELEVENLABS_PROVIDER_ID = 'elevenlabs';

class ElevenLabsSynthesizer implements Synthesizer {
  readonly name = 'elevenlabs';
  private key: string | null = null;
  constructor(private readonly ctx: SynthesizerCreateContext) {}

  async synthesize(text: string, opts: SynthesizeOptions = {}): Promise<SynthesisResult> {
    this.key ??= (await this.ctx.getSecret?.('ELEVENLABS_API_KEY')) ?? null;
    if (!this.key) {
      throw new MoxxyError({
        code: 'AUTH_NO_CREDENTIALS',
        message: 'No ElevenLabs API key. Run `moxxy vault set ELEVENLABS_API_KEY`.',
        hint: 'moxxy vault set ELEVENLABS_API_KEY',
        context: { provider: ELEVENLABS_PROVIDER_ID },
      });
    }
    const voice = opts.voice ?? (this.ctx.config.voice as string | undefined) ?? 'Rachel';
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voice}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'xi-api-key': this.key, 'content-type': 'application/json', accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
        signal: opts.signal,
      });
    } catch (err) {
      const network = classifyNetworkError(err, { provider: ELEVENLABS_PROVIDER_ID, url });
      if (network) throw network;
      throw err;
    }
    if (!res.ok) {
      const classified = classifyHttpStatus(res.status, {
        provider: ELEVENLABS_PROVIDER_ID,
        url,
        body: await res.text(),
      });
      if (classified) throw classified;
      throw new MoxxyError({
        code: 'PROVIDER_BAD_REQUEST',
        message: `ElevenLabs returned HTTP ${res.status}.`,
        context: { provider: ELEVENLABS_PROVIDER_ID, url, status: res.status },
      });
    }
    return { audio: new Uint8Array(await res.arrayBuffer()), mimeType: 'audio/mpeg' };
  }
}

export const elevenLabsDef = defineSynthesizer({
  name: 'elevenlabs',
  displayName: 'ElevenLabs',
  create: (ctx) => new ElevenLabsSynthesizer(ctx),
});

export default definePlugin({
  name: '@moxxy/plugin-tts-elevenlabs',
  version: '0.0.0',
  synthesizers: [elevenLabsDef],
});
```

Reuse the SDK's `classifyHttpStatus` / `classifyNetworkError` — the same helpers the Whisper transcribers use — so a bad key becomes `AUTH_DENIED`, a 429 becomes a rate-limit error, etc., instead of leaking the raw vendor body.

## Registry behavior — auto-adopt-first + lazy build

`SynthesizerRegistry` is **not** wired like `TranscriberRegistry`. Two differences that matter:

- **`autoAdoptFirst: true`** — the first synthesizer registered becomes active automatically. A user who asks the agent to author an ElevenLabs plugin gets read-aloud through it immediately, with no explicit activate step. (Transcribers require an explicit `setActive`.)
- **`buildOnRead: true`** — because `active` can be set before any instance is built, the active synthesizer is (re)built lazily on the first `getActive()`. Keep `create()` side-effect-free and cheap; it may run more than once.

`getActive()` *throws* when none is active; read-aloud surfaces use **`tryGetActive()`** and fall back to the OS voice on `null`. There is at most one active synthesizer.

## The agent switches voices via `set_voice` — you write no activation code

There is no settings UI. The agent controls TTS through the built-in `@moxxy/voice-admin` tools:

- `list_voices` → `{ active, available }`, where `available` is `['system', ...registered names]` and `'system'` means the OS voice.
- `set_voice({ synthesizer })` → activate a registered name, or `'system'` to `clearActive()` (back to the OS voice).

Because of auto-adopt-first, a freshly authored/installed plugin is already active on load; `set_voice` is only for switching afterward. **Don't write your own activation step** — just register the def.

## Empty / contract hygiene (the STT lesson, applied to TTS)

The Codex transcriber once *threw* on a benign empty transcript and every caller's graceful path went dead. Mirror the fix on the TTS side:

- A genuine failure (missing key, HTTP error, network) → throw a **classified `MoxxyError`**. Callers already degrade to the OS voice via `tryGetActive()`, so a throw is safe and visible.
- Always set `mimeType` to what you actually return — don't hardcode `audio/mpeg` if you switched a config to wav. The desktop plays the bytes by that declared type.
- Honor `opts.signal`: read-aloud is cancellable, so pass the abort signal into `fetch` to free the socket.

## Ship + discover

- **Built-in:** add the def to a plugin and register it in the CLI's `setup`.
- **Third-party / self-authored:** drop the `@moxxy/plugin-tts-*` package under `~/.moxxy/plugins` — auto-discovery picks it up and (being first) auto-adopts it. The naming convention is `@moxxy/plugin-tts-<vendor>` (mirrors `plugin-stt-*` for speech-to-text).

If the plugin needs a credential to work, declare a `synthesizer` requirement (plus the vault key it needs) so `moxxy doctor` / onboarding can surface a friendly gap — see the requirements guide; `'synthesizer'` is a first-class `RequirementKind`.

## Tests

Mirror `plugin-stt-whisper-codex/src/index.test.ts`: stand up a local `http.createServer`, point the synthesizer at it via injected config/baseURL, drive `synthesize('hello')`, and assert (a) the request shape (auth header, body), (b) the returned `{ audio, mimeType }`, and (c) that a non-2xx maps to a classified `MoxxyError` rather than leaking the raw body. No real vendor account needed.

## Don't

- **Don't read keys from `process.env`.** Use `ctx.getSecret` so the key stays out of the model's context and rides the vault.
- **Don't do heavy work in `create()`.** It runs lazily on read and may re-run; resolve the key and open connections inside `synthesize`.
- **Don't write an activation step.** Auto-adopt-first activates the first registered synthesizer; `set_voice` handles switching.
- **Don't assume the output is MP3.** Set `mimeType` to what you actually return.
- **Don't forget `opts.signal`.** Pass it to `fetch` so a cancelled read-aloud frees the socket.
