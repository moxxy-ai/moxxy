# @moxxy/e2e

End-to-end-encrypted secure channel for the **proxy** tunnel. It lets a phone and
a locally-running agent talk through an untrusted relay (`<uuid>.proxy.moxxy.ai`)
such that the relay sees only ciphertext it can neither read nor forge.

## Why

The relay terminates the outer TLS, so on its own it would see plaintext — the
same position ngrok/cloudflared are in today. This package closes that gap with an
application-layer handshake **inside** the tunnel, authenticated out-of-band via
the fingerprint printed in the QR code.

## Design

- **Identity** — the agent holds a long-lived Ed25519 keypair. Its public key is
  the identity: the QR carries `fp = base64url(pubkey)`, and the subdomain is
  `uuid = base32(sha256(pubkey))`. The phone recomputes the expected uuid from the
  pinned `fp`, so the subdomain is verifiable, not just trusted. No accounts.
- **Handshake** — signed ephemeral ECDH (station-to-station-lite): the phone sends
  an X25519 ephemeral; the agent replies with its own ephemeral, its identity key,
  and an Ed25519 signature over the transcript. The phone pins the identity key
  (constant-time) and verifies the signature, so a relay without the private key
  cannot impersonate the agent. Ephemerals give forward secrecy.
- **Framing** — XChaCha20-Poly1305 per message, with a strictly-increasing
  sequence number bound as AAD, so the relay cannot replay, reorder, or tamper.
  Directional keys prevent reflection.

The phone is authenticated to the agent by the existing bearer token, which now
travels encrypted inside this channel.

## Entry points

- `@moxxy/e2e` — pure JS (`@noble/*`), **no Node built-ins**, bundles under
  Metro/React Native. Identity math, handshake, framing, `SecureChannel`.
- `@moxxy/e2e/node` — `loadOrCreateIdentity()` (persists the secret key 0600 at
  `~/.moxxy/proxy-identity.key`). Node only.

> RN note: `@noble`'s randomness uses WebCrypto `getRandomValues`; an Expo app
> must import a polyfill (`react-native-get-random-values`) at startup.
