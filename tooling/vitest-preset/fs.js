import { rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';

// How a test removes what it made. Windows refuses to remove a file or a
// folder for a moment while something still has it open or is adding to it:
// a child process that has it as its cwd, a write that is just landing, the
// virus scanner or the search indexer reading a new file. Node retries exactly
// those refusals (EBUSY, ENOTEMPTY, EPERM, EMFILE, ENFILE) when asked, so a
// cleanup on a busy runner waits them out instead of failing the test.
// A test whose own code is still writing should still wait for that work to
// end first; this covers what the test cannot wait for. The backoff is linear,
// so the last try comes about 5.5 s after the first refusal.
const options = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };

/** Removes a path and everything under it; a missing path is fine. */
export function removeDir(path) {
  return rm(path, options);
}

/** `removeDir` for synchronous cleanup (an `exit` handler, a sync `afterEach`). */
export function removeDirSync(path) {
  rmSync(path, options);
}
