import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Session, silentLogger } from '@moxxy/core';
import { MOXXY_WORKSPACE_ID, WorkspaceRegistry } from '@moxxy/workspace-registry';
import { describe, expect, it } from 'vitest';

import { attachSessionPersistence } from './persistence';

describe('attachSessionPersistence workspace registry sync', () => {
  it('does not register an empty TUI session before the first user-visible event', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-home-'));
    const original = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    try {
      const cwd = path.join(home, 'untracked-project');
      mkdirSync(cwd, { recursive: true });
      const session = new Session({ cwd, logger: silentLogger });

      attachSessionPersistence(session, cwd, false);
      await new Promise((resolve) => setTimeout(resolve, 350));

      const registry = new WorkspaceRegistry(path.join(home, 'desktop', 'desks.json'));
      expect(await registry.list()).toEqual([]);
      await session.close();
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });

  it('does not register a TUI session for non-user events only', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-home-'));
    const original = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    try {
      const cwd = path.join(home, 'untracked-project');
      mkdirSync(cwd, { recursive: true });
      const session = new Session({ cwd, logger: silentLogger });

      attachSessionPersistence(session, cwd, false);
      await session.log.append({
        type: 'assistant_message',
        turnId: 'turn-1',
        text: 'Boot noise without a user prompt',
      });
      await new Promise((resolve) => setTimeout(resolve, 350));

      const registry = new WorkspaceRegistry(path.join(home, 'desktop', 'desks.json'));
      expect(await registry.list()).toEqual([]);
      await session.close();
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });

  it('registers and updates a TUI session in the shared workspace registry', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'moxxy-home-'));
    const original = process.env.MOXXY_HOME;
    process.env.MOXXY_HOME = home;
    try {
      const cwd = path.join(home, 'untracked-project');
      mkdirSync(cwd, { recursive: true });
      const session = new Session({ cwd, logger: silentLogger });

      attachSessionPersistence(session, cwd, false);
      await session.log.append({
        type: 'user_prompt',
        turnId: 'turn-1',
        text: 'Summarize this project',
      });
      await new Promise((resolve) => setTimeout(resolve, 350));

      const registry = new WorkspaceRegistry(path.join(home, 'desktop', 'desks.json'));
      const moxxy = (await registry.list()).find((desk) => desk.id === MOXXY_WORKSPACE_ID);
      expect(moxxy?.sessions).toHaveLength(1);
      expect(moxxy?.sessions[0]).toMatchObject({
        id: String(session.id),
        cwd,
        firstPrompt: 'Summarize this project',
        eventCount: 1,
        source: 'tui',
      });
      await session.close();
    } finally {
      if (original === undefined) delete process.env.MOXXY_HOME;
      else process.env.MOXXY_HOME = original;
    }
  });
});
