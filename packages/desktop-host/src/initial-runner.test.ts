/**
 * Which runner the app starts with. With no workspace picked (the first-run
 * step was skipped) it used to start in whatever folder the app process ran
 * from — the repo in dev, `/` for an app opened from Finder — so the agent
 * worked there. It now starts in the Moxxy workspace's own folder.
 */
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { removeDirSync } from '@moxxy/vitest-preset/fs';
import { MOXXY_WORKSPACE_ID, WorkspaceRegistry } from './desks';
import { initialRunnerTarget } from './initial-runner';
import { UNBOUND_ID } from './runner-pool';

let home: string;
let previousHome: string | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(os.tmpdir(), 'initial-runner-'));
  previousHome = process.env.MOXXY_HOME;
  process.env.MOXXY_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.MOXXY_HOME;
  else process.env.MOXXY_HOME = previousHome;
  removeDirSync(home);
});

describe('initialRunnerTarget', () => {
  it('starts a fresh install in the Moxxy workspace folder, saved and in front', async () => {
    const desks = new WorkspaceRegistry();

    const target = await initialRunnerTarget(desks);

    expect(target).toEqual({ id: UNBOUND_ID, cwd: path.join(home, 'Moxxy') });
    expect(existsSync(target.cwd)).toBe(true);
    expect((await desks.getActive())?.id).toBe(MOXXY_WORKSPACE_ID);
  });

  it("resumes the active workspace's active session in that workspace's folder", async () => {
    const desks = new WorkspaceRegistry();
    const cwd = path.join(home, 'project');
    mkdirSync(cwd);
    const project = await desks.create({ name: 'Project', cwd });

    expect(await initialRunnerTarget(desks)).toEqual({ id: project.activeSessionId, cwd });
  });
});
