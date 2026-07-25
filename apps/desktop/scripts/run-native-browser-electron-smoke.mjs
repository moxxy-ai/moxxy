import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import electron from 'electron';
import { build } from 'vite';

const outputDir = path.join(import.meta.dirname, '..', `.tmp-native-browser-smoke-${process.pid}`);
const output = path.join(outputDir, 'smoke.mjs');
const resultPath = path.join(outputDir, 'result.json');

try {
  await build({
    configFile: false,
    logLevel: 'warning',
    build: {
      ssr: path.join(import.meta.dirname, 'native-browser-electron-smoke.ts'),
      outDir: outputDir,
      emptyOutDir: true,
      target: 'node20',
      rollupOptions: {
        external: ['electron', /^node:/, /^@moxxy\//],
        output: { format: 'es', entryFileNames: 'smoke.mjs' },
      },
    },
  });
  const launched = spawnSync(electron, [output], {
    encoding: 'utf8',
    env: { ...process.env, MOXXY_NATIVE_BROWSER_SMOKE_RESULT: resultPath },
    timeout: 60_000,
  });
  if (launched.error) throw launched.error;
  if (launched.stdout) process.stdout.write(launched.stdout);
  if (launched.stderr) process.stderr.write(launched.stderr);
  const result = waitForResult(resultPath, 60_000);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}

function waitForResult(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    Atomics.wait(waitArray, 0, 0, 100);
  }
  let progress = 'no progress recorded';
  try {
    progress = readFileSync(`${file}.progress`, 'utf8').trim() || progress;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  throw new Error(
    `native browser Electron smoke timed out after ${timeoutMs}ms (progress: ${progress})`,
  );
}
