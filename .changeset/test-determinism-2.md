---
'@moxxy/cli': patch
---

Two more tests that measured the machine rather than the behaviour.

The HTTP channel's auth-disabled test guessed a port in 50000-60000 and copied it onto a second channel with `Object.assign`, which is exactly the `EADDRINUSE` flake the file's own helper exists to avoid. It failed CI on a docs-only PR. It now uses the same `port: 0` plus `boundPort` pattern as every other test in that file.

The MCP parallel-boot test slept 50 ms per server and required the whole boot under 90 ms. Two parallel 50 ms sleeps routinely exceed that on a loaded suite. It now asserts the property directly by observing how many `listTools` calls are in flight at once, which cannot be wrong because the box is busy.
