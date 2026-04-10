# Moxxy Playwright Sidecar

A small Node.js JSON-RPC server that wraps `playwright-core` and is supervised
by the moxxy-runtime `browser::Manager`. The Rust runtime spawns this sidecar
on demand as a child process and communicates over stdin/stdout using
line-delimited JSON.

## Protocol

Each request is one JSON object per line on stdin:

```
{"id":42,"method":"page.goto","params":{"session_id":"...","url":"..."}}
```

Each response is one JSON object per line on stdout:

```
{"id":42,"ok":true,"result":{...}}
{"id":42,"ok":false,"error":{"code":"timeout","message":"..."}}
```

The sidecar logs to stderr (consumed by the runtime as `tracing` events).

## Methods

See `sidecar.mjs` — the dispatch table at the bottom of the file enumerates
every supported method and its expected params.

## Local development

```sh
cd ~/.moxxy/sidecars/playwright   # populated on first browser primitive call
node sidecar.mjs                  # then type JSON-RPC requests on stdin
```

The Rust side bundles `package.json`, `package-lock.json`, and `sidecar.mjs`
into the binary via `include_str!`, so changes to these files require a
rebuild of the runtime crate. The marker file `.installed-v1` is bumped
whenever the bundled assets change so existing installs auto-refresh.
