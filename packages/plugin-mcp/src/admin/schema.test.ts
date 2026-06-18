import { describe, expect, it } from 'vitest';
import { MoxxyError } from '@moxxy/sdk';
import { type AddServerInput, validateAddServerInput } from './schema.js';

const input = (over: Partial<AddServerInput>): AddServerInput =>
  ({ kind: 'stdio', name: 'demo', command: 'noop', autoSkill: true, ...over }) as AddServerInput;

describe('validateAddServerInput', () => {
  it('builds a stdio config and strips autoSkill', () => {
    const cfg = validateAddServerInput(input({ command: 'npx', args: ['x'], autoSkill: true }));
    expect(cfg).toEqual({ kind: 'stdio', name: 'demo', command: 'npx', args: ['x'] });
    expect('autoSkill' in cfg).toBe(false);
  });

  it('builds an http config and strips autoSkill', () => {
    const cfg = validateAddServerInput(
      input({ kind: 'http', command: undefined, url: 'https://x.test', headers: { a: 'b' } }),
    );
    expect(cfg).toEqual({ kind: 'http', name: 'demo', url: 'https://x.test', headers: { a: 'b' } });
    expect('autoSkill' in cfg).toBe(false);
  });

  it('throws CONFIG_INVALID when kind="stdio" omits command', () => {
    let err: unknown;
    try {
      validateAddServerInput(input({ kind: 'stdio', command: undefined }));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(MoxxyError);
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
    expect((err as Error).message).toMatch(/requires a `command`/);
  });

  it('throws CONFIG_INVALID when kind="http" omits url', () => {
    expect(() => validateAddServerInput(input({ kind: 'http', command: undefined }))).toThrow(
      /requires a `url`/,
    );
  });

  it('throws CONFIG_INVALID when kind="sse" omits url', () => {
    let err: unknown;
    try {
      validateAddServerInput(input({ kind: 'sse', command: undefined }));
    } catch (e) {
      err = e;
    }
    expect((err as MoxxyError).code).toBe('CONFIG_INVALID');
    expect((err as Error).message).toMatch(/kind="sse"/);
  });
});
