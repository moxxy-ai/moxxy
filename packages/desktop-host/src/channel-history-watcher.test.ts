import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchChannelHistory } from './channel-history-watcher';

let dir: string;
let stop: () => void = () => undefined;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'moxxy-chan-watch-'));
});

afterEach(() => {
  stop();
  rmSync(dir, { recursive: true, force: true });
});

const waitFor = async (check: () => boolean, ms = 3_000): Promise<void> => {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('watchChannelHistory', () => {
  it("reports which channel's conversation log changed (debounced), ignoring other sessions", async () => {
    const changed: string[] = [];
    stop = watchChannelHistory(['discord', 'telegram'], (id) => changed.push(id), { dir, debounceMs: 20 });

    writeFileSync(path.join(dir, 'some-desktop-session.jsonl'), '{}\n');
    writeFileSync(path.join(dir, 'moxxy-channel-discord.jsonl'), '{}\n');
    writeFileSync(path.join(dir, 'moxxy-channel-discord.jsonl'), '{}\n{}\n');

    await waitFor(() => changed.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(changed).toEqual(['discord']);
  });
});
