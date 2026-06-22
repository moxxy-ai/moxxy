/**
 * Installs the WebCrypto RNG the E2E pairing handshake needs under Hermes.
 *
 * Pairing over the proxy relay (`wss://…?fp=…`) runs the `@moxxy/e2e` Noise
 * handshake (via `@noble`), which draws its nonces and ephemeral keys from
 * `globalThis.crypto.getRandomValues`. Hermes (React Native) ships no global
 * WebCrypto RNG, so without this the first handshake frame throws
 * `crypto.getRandomValues must be defined` and the connection dies before the
 * socket opens — the symptom is a pairing that never reaches `open`. Back it
 * with `expo-crypto`, which exposes a synchronous, WebCrypto-shaped
 * `getRandomValues` (and is available both in Expo Go and a native build).
 *
 * This is a side-effect module: importing it installs the RNG. It MUST be the
 * first import in the app entry (`index.ts`), before any transport/router module
 * can run, so the global is in place no matter when the handshake fires.
 */
import * as ExpoCrypto from 'expo-crypto';

type CryptoLike = { getRandomValues?: <T extends ArrayBufferView>(array: T) => T };
const g = globalThis as typeof globalThis & { crypto?: CryptoLike };

if (typeof g.crypto?.getRandomValues !== 'function') {
  const impl = <T extends ArrayBufferView>(array: T): T =>
    ExpoCrypto.getRandomValues(array as never) as unknown as T;
  if (g.crypto) {
    // `globalThis.crypto` may exist but lack a usable RNG; install onto it,
    // falling back to defineProperty if the host object is frozen.
    try {
      g.crypto.getRandomValues = impl;
    } catch {
      Object.defineProperty(g.crypto, 'getRandomValues', { value: impl, configurable: true });
    }
  } else {
    Object.defineProperty(g, 'crypto', { value: { getRandomValues: impl }, configurable: true });
  }
}
