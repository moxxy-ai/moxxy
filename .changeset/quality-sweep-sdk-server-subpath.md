---
"@moxxy/sdk": patch
"@moxxy/cli": patch
---

Quality sweep — split Node-only `@moxxy/sdk` helpers behind a `./server` subpath (browser/RN boundary)

Purely structural, behavior-preserving (`t2-sdk-server-subpath`, retires TECH_DEBT #13):

- New `@moxxy/sdk/server` subpath export. The Node-runtime VALUE helpers that
  statically reach `node:*` builtins — `spawnCliTunnel`/`isCliTunnelAvailable`
  (`node:child_process`), `writeFileAtomic`/`writeFileAtomicSync`/`moxxyHome`/
  `moxxyPath` (`node:fs`/`os`), `readRequestBody`/`bearerTokenMatches`
  (`node:http`/`crypto`), and the channel-auth helpers (`resolveChannelToken`/
  `rotateChannelToken`/`bearerGuard`/`encodeWsBearerProtocol`/
  `tokenFromWsProtocolHeader`/`MOXXY_WS_SUBPROTOCOL`/
  `MOXXY_WS_BEARER_PROTOCOL_PREFIX`) — now live on `@moxxy/sdk/server` and are
  dropped from the main barrel. The corresponding pure TYPE exports
  (`TunnelHandle`, `WriteFileAtomicOptions`, `ChannelTokenOptions`, …) stay on
  the main barrel (erased at build time). The main barrel + `./tool-display`
  subpath are now provably free of Node builtins, so a browser/React-Native
  bundle can value-import from them safely.

- Every Node-side consumer re-pointed from `@moxxy/sdk` to `@moxxy/sdk/server`
  for those symbols (cli, core, desktop-host, channel/oauth/webhooks/mcp/
  workflows/scheduler/vault/memory plugins, ipc-server-ws, config, testing,
  apps/desktop/electron).
