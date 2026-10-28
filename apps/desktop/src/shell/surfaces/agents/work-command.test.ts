import { describe, expect, it } from 'vitest';
import type { MoxxyEvent } from '@moxxy/sdk';
import { commandOf } from './work-command';

let seq = 0;
function call(name: string, input: unknown): MoxxyEvent {
  seq += 1;
  return { id: `e${seq}`, seq, ts: seq, turnId: 'T', sessionId: 'S', source: 'model', type: 'tool_call_requested', callId: `c${seq}`, name, input } as unknown as MoxxyEvent;
}

describe('commandOf', () => {
  it('finds the command a background work ran by the name the agent gave it', () => {
    const events = [call('Bash', { command: 'npm run dev -- --port 5198', description: 'Start dev server', run_in_background: true })];
    expect(commandOf(events, 'Start dev server')).toBe('npm run dev -- --port 5198');
  });

  it('finds it when the work is named by the command itself', () => {
    expect(commandOf([call('Bash', { command: 'npx vite', run_in_background: true })], 'npx vite')).toBe('npx vite');
  });

  it('takes the latest start when the agent ran the same work again', () => {
    const events = [
      call('Bash', { command: 'npm run dev', description: 'Start dev server', run_in_background: true }),
      call('Bash', { command: 'npm run dev -- --port 5199', description: 'Start dev server', run_in_background: true }),
    ];
    expect(commandOf(events, 'Start dev server')).toBe('npm run dev -- --port 5199');
  });

  it('knows no command for work it cannot match, or a command that did not go to the background', () => {
    const events = [call('Bash', { command: 'npm test', description: 'Run tests' }), call('Read', { file_path: 'a.ts' })];
    expect(commandOf(events, 'Run tests')).toBeNull();
    expect(commandOf(events, 'Helper')).toBeNull();
  });
});
