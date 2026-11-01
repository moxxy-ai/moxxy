import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { removeWorkDir } from './agent-cli-env.mjs';

const onlyWindows = {
  skip: process.platform !== 'win32' && 'only Windows refuses to remove a folder a process is in',
};

function workDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'moxxy-agent-cli-env-'));
  mkdirSync(path.join(dir, 'opencode-work'));
  writeFileSync(path.join(dir, 'opencode-work', 'live-result.txt'), 'PONG');
  return dir;
}

/** A process whose cwd is the folder holds it the way an agent CLI that is still exiting does. */
async function holdFolder(dir) {
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], { cwd: dir, stdio: 'ignore' });
  await once(holder, 'spawn');
  return holder;
}

test('removes the work folder and what is in it', async () => {
  const dir = workDir();

  assert.equal(await removeWorkDir(dir), null);
  assert.equal(existsSync(dir), false);
});

test('waits for a folder Windows holds for a moment after an agent exits', onlyWindows, async () => {
  const dir = workDir();
  const holder = await holdFolder(dir);
  setTimeout(() => holder.kill(), 1_000);

  assert.equal(await removeWorkDir(dir), null);
  assert.equal(existsSync(dir), false);
});

test('a folder that stays held is reported, not thrown, so the checks keep their result', onlyWindows, async (t) => {
  const dir = workDir();
  const holder = await holdFolder(dir);
  try {
    const warning = await removeWorkDir(dir);
    // Not every Windows holds it: the GitHub runner removes such a folder at once.
    if (warning === null && !existsSync(dir)) {
      t.skip('this Windows removes a folder a process is in');
      return;
    }
    assert.match(warning ?? '', /could not remove .*moxxy-agent-cli-env-.*\((EPERM|EBUSY)\)/);
  } finally {
    holder.kill();
    await once(holder, 'exit');
    await removeWorkDir(dir);
  }
});
