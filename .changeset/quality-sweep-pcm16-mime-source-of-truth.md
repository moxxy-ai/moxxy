---
"@moxxy/sdk": patch
"@moxxy/cli": patch
---

Quality sweep — single-source the `MOXXY_PCM16_24KHZ_MIME` wire constant (`u35-2`)

Behavior-preserving (same string `audio/x-moxxy-pcm16-24khz`). The cross-package
PCM16 MIME protocol tag was independently redeclared as a literal in three
consumers; they now import the SDK's hoisted source of truth instead:

- New dependency-free `@moxxy/sdk/transcriber` subpath export (mirrors
  `./tool-display`) so the browser/RN `@moxxy/client-platform-web` package can
  value-import the constant without dragging `node:*` builtins from the main
  barrel. `transcriber.ts` is pure (consts + interfaces, zero imports), so the
  subpath stays browser-safe.
- `@moxxy/client-platform-web` (`src/pcm16.ts`) re-exports the constant from
  `@moxxy/sdk/transcriber`; gains `@moxxy/sdk` as a dependency.
- `@moxxy/plugin-stt-whisper` (`src/audio.ts`) imports + re-exports from
  `@moxxy/sdk`, keeping its existing public surface stable.
- `@moxxy/plugin-cli` (`src/session/use-voice-input.ts`) imports from
  `@moxxy/sdk`, dropping the inline literal.

No protocol bump; no cycles (`check:deps` clean); SDK keeps zero internal deps.
