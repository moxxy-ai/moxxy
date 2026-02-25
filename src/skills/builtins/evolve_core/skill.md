# `evolve_core` Tool

## Description
This tool compiles, tests, and safely restarts the moxxy framework backend. It is the core mechanism for **Self-Evolution** and requires explicit user confirmation before execution.

## When to use
- IMMEDIATELY after you use `host_shell` to write, modify, or extend any `.rs` files or capabilities inside the core moxxy filesystem.
- When the user asks you to upgrade, update, or modify the framework itself.

## What it does
1. **Safety Checks:** Runs `cargo check` and `cargo test` sequentially. If your code modifications have a syntax error, this tool will fail safely and return the compiler errors to you.
2. **Compilation:** Runs `cargo build --release` on the host to generate the new binary.
3. **Watchdog Restart:** Takes a backup snapshot of the stable binary, detaches a system timeout watchdog, and cleanly kills and restarts the background Engine. If your new compiled code instantly panics or crashes within 5 seconds of booting, the watchdog automatically restores the snapshot and resurrects the framework. 

## Inputs
This tool takes no arguments. Simply calling `evolve_core` triggers the auto-compilation pipeline over the existing codebase root directory. 

## Output
If successful, the engine will restart (the immediate API call may disconnect unexpectedly). If a syntax error occurs, the compiler `stderr` will be returned.
