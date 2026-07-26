import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import electron from 'electron';
import { build } from 'vite';

const outputDir = path.join(import.meta.dirname, '..', `.tmp-native-browser-smoke-${process.pid}`);
const output = path.join(outputDir, 'smoke.mjs');
const exerciseResultPath = path.join(outputDir, 'exercise-result.json');
const restartResultPath = path.join(outputDir, 'restart-result.json');
const userDataPath = path.join(outputDir, 'user-data');

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
  mkdirSync(userDataPath, { recursive: true });
  const exercise = launchElectron('exercise', exerciseResultPath);
  const restart = launchElectron('verify-restart', restartResultPath);
  const result = {
    ...exercise,
    restoredTabs: restart.restoredTabs,
    persistentLogin: restart.persistentLogin,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
} finally {
  rmSync(outputDir, { recursive: true, force: true });
}

function launchElectron(phase, resultPath) {
  const launched = spawnSync(electron, [output], {
    encoding: 'utf8',
    env: {
      ...process.env,
      MOXXY_NATIVE_BROWSER_SMOKE_RESULT: resultPath,
      MOXXY_NATIVE_BROWSER_SMOKE_USER_DATA: userDataPath,
      MOXXY_NATIVE_BROWSER_SMOKE_PHASE: phase,
    },
    timeout: 60_000,
  });
  if (launched.error) throw launched.error;
  if (launched.stdout) process.stdout.write(launched.stdout);
  if (launched.stderr) process.stderr.write(launched.stderr);
  const result = waitForResult(resultPath, 60_000);
  if (!result.ok) throw new Error(`native browser Electron ${phase} smoke failed`);
  return result;
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
