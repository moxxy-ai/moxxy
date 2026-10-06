import { describe, expect, it } from 'vitest';
import { Session, autoAllowResolver, silentLogger } from '@moxxy/core';
import { buildAppCommands } from './slash-handler.js';

const session = () => new Session({ cwd: '/tmp', logger: silentLogger, permissionResolver: autoAllowResolver });

describe('the /model application command', () => {
  it('is published with an optional "name" option that suggests models as you type', () => {
    const cmd = buildAppCommands(session()).find((c) => c.name === 'model');
    expect(cmd).toBeDefined();
    expect(cmd?.options).toEqual([
      expect.objectContaining({ type: 3, name: 'name', required: false, autocomplete: true }),
    ]);
  });
});

describe('the /auto-approve application command', () => {
  it('is published as /auto-approve (the /yolo name stays a typed alias only)', () => {
    const names = buildAppCommands(session()).map((c) => c.name);
    expect(names).toContain('auto-approve');
    expect(names).not.toContain('yolo');
  });
});

describe('the voice call application commands', () => {
  it('publishes /call and /hangup', () => {
    const names = buildAppCommands(session()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['call', 'hangup']));
  });
});
