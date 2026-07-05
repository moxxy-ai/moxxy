#!/usr/bin/env node
/**
 * sherpa-onnx TTS sidecar — a forked child that owns the native sherpa addon.
 *
 * It exists as a SEPARATE process for one hard reason (see ./platform.ts): the
 * addon's shared libraries only resolve when `DYLD_LIBRARY_PATH` /
 * `LD_LIBRARY_PATH` points at the platform package dir AT PROCESS START, so the
 * parent forks this with that env pre-set. Forking (not `spawn`) gives us a
 * structured IPC channel; the parent uses `serialization: 'advanced'` so the
 * `Float32Array` of samples round-trips without manual byte packing.
 *
 * Protocol: {@link ./host-protocol.ts}. This module is the thin runtime glue —
 * lazily `require`ing the native module (a dlopen failure becomes a classified
 * `init` reply rather than a boot crash), plus lifecycle self-termination so an
 * orphaned sidecar never lingers.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import {
  createMessageHandler,
  type HostReply,
  type HostRequest,
  type SherpaModule,
} from './host-protocol.js';

const require = createRequire(import.meta.url);

/** Lazy native load — deferred so a missing/broken addon is a caught, reported
 *  `init` error on the first synthesize, not an unhandled boot exception. */
function loadSherpa(): SherpaModule {
  return require('sherpa-onnx-node') as SherpaModule;
}

function send(reply: HostReply): void {
  // `process.send` is defined only when spawned with an IPC channel (our fork).
  process.send?.(reply);
}

function isRequest(msg: unknown): msg is HostRequest {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    (msg as { type?: unknown }).type === 'synthesize' &&
    typeof (msg as { id?: unknown }).id === 'number'
  );
}

/**
 * Self-terminate if the parent runner disappears. `fork` delivers a
 * `disconnect` event when the IPC channel closes (parent exit / explicit
 * disconnect); belt-and-braces, poll the parent PID too — a hard SIGKILL of the
 * parent may not always close the channel promptly.
 */
function armLifecycle(): void {
  process.on('disconnect', () => process.exit(0));
  const parentPid = process.ppid;
  if (!parentPid || parentPid <= 1) return;
  const timer = setInterval(() => {
    try {
      process.kill(parentPid, 0); // existence probe, no signal delivered
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') process.exit(0);
      // EPERM ⇒ the process exists but we can't signal it — still alive.
    }
  }, 3000);
  timer.unref?.();
}

function main(): void {
  const handle = createMessageHandler(loadSherpa);
  // Serialise requests: sherpa's OfflineTts is not re-entrant, and processing
  // one at a time keeps memory bounded under a burst of read-aloud calls.
  let queue: Promise<void> = Promise.resolve();
  process.on('message', (msg: unknown) => {
    if (!isRequest(msg)) return;
    queue = queue
      .then(async () => {
        const reply = await handle(msg);
        send(reply);
      })
      .catch((err) => {
        send({
          id: msg.id,
          ok: false,
          error: { message: err instanceof Error ? err.message : String(err), kind: 'runtime' },
        });
      });
  });
  armLifecycle();
}

// Run only when executed as the forked child, never when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
