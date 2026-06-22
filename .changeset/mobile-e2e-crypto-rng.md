---
'@moxxy/mobile-gateway-app': patch
---

Fix mobile pairing over the proxy relay (`wss://…?fp=…`). The `@moxxy/e2e` Noise
handshake draws its nonces and ephemeral keys from
`globalThis.crypto.getRandomValues`, which Hermes (React Native) does not
provide — so the encrypted handshake threw `crypto.getRandomValues must be
defined` before the socket ever opened, and pairing failed with a generic
"couldn't connect to this gateway". Install a WebCrypto `getRandomValues`
polyfill backed by `expo-crypto` as the first import in the app entry (works in
Expo Go and native builds).

Also narrow the Metro crawl: keep `watchFolders` at the repo root (so transitive
`@moxxy/*` workspace deps still resolve) but add a `blockList` for `.git`, the
multi-GB `.claude/worktrees`, and the other monorepo apps, so a cold start no
longer traverses the whole workspace.
