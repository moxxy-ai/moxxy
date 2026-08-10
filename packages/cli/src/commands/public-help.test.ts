import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseArgv } from '../argv.js';
import { runChannelsCommand } from './channels.js';
import { runConfigCommand } from './config.js';
import { runLoginCommand } from './login.js';
import { runPermsCommand } from './perms.js';
import { runPromptCommand } from './prompt.js';
import { runProvisionCommand } from './provision.js';
import { runProfileCommand } from './profile.js';
import { runResumeCommand } from './resume.js';
import { runTuiCommand } from './tui.js';

const CASES = [
  ['channels', runChannelsCommand],
  ['config', runConfigCommand],
  ['login', runLoginCommand],
  ['perms', runPermsCommand],
  ['prompt', runPromptCommand],
  ['provision', runProvisionCommand],
  ['profile', runProfileCommand],
  ['resume', runResumeCommand],
  ['tui', runTuiCommand],
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('public command help', () => {
  it.each(CASES)('%s --help exits without starting the command', async (name, handler) => {
    let output = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output += String(chunk);
      return true;
    });

    const result = await handler(parseArgv([name, '--help']));

    expect(result).toBe(0);
    expect(output).toContain(`moxxy ${name === 'prompt' ? '-p' : name}`);
  });
});
