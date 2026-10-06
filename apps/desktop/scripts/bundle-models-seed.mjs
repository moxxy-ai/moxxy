#!/usr/bin/env node
/**
 * Assemble `resources/models-seed` — the offline voices the desktop ships, so
 * speech works on the first launch with no download. The packaged app copies
 * them into `~/.moxxy/models` (see `@moxxy/desktop-host` seed-models.ts).
 *
 * The voices are the plugin's own catalog, fetched and checked by the plugin's
 * own downloader: what ships is byte-for-byte what a first use would have
 * downloaded, and the plugin recognises it by the same `.model.ok` marker.
 * A voice already in place is reused, so a rebuild downloads nothing.
 *
 * IMPORTANT: build the workspace first — this reads the packages' dist/.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureModel } from '../../../packages/model-fetch/dist/index.js';
import { VOICE_CATALOG } from '../../../packages/plugin-tts-local/dist/voices.js';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const voicesDir = path.join(desktopDir, 'resources', 'models-seed', 'tts');
// Archives are staged outside the tree electron-builder copies.
const stagingDir = path.join(desktopDir, 'resources', '.models-download');

mkdirSync(voicesDir, { recursive: true });
const wanted = new Set(VOICE_CATALOG.map((voice) => voice.id));
for (const name of readdirSync(voicesDir)) {
  if (!wanted.has(name)) rmSync(path.join(voicesDir, name), { recursive: true, force: true });
}

for (const voice of VOICE_CATALOG) {
  const { skipped } = await ensureModel({
    url: voice.url,
    sha256: voice.sha256,
    dir: path.join(voicesDir, voice.id),
    cacheDir: stagingDir,
  });
  console.log(`models-seed: ${voice.id} ${skipped ? 'already in place' : `downloaded (~${voice.approxMb} MB)`}`);
}
rmSync(stagingDir, { recursive: true, force: true });
console.log(`models-seed assembled at ${voicesDir} (${VOICE_CATALOG.length} voices)`);
