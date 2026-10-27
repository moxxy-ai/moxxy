import { describe, expect, it } from 'vitest';
import { describeAgentStatus, operationDetail } from './gpt-live-status';

const MINUTE = 60_000;

describe('operationDetail', () => {
  it('names the command, file or site, never more', () => {
    expect(operationDetail({ command: 'pnpm test --filter desktop\nsecond line' })).toBe('pnpm test --filter desktop');
    expect(operationDetail({ file_path: '/Users/me/project/src/app.ts', content: 'SECRET' })).toBe('app.ts');
    expect(operationDetail({ path: 'docs/README.md' })).toBe('README.md');
    expect(operationDetail({ url: 'https://example.com/private?token=abc' })).toBe('example.com');
    expect(operationDetail({ query: 'weather' })).toBeUndefined();
    expect(operationDetail(null)).toBeUndefined();
  });

  it('shortens a long command', () => {
    const detail = operationDetail({ command: `echo ${'x'.repeat(200)}` });
    expect(detail?.length).toBeLessThanOrEqual(60);
    expect(detail?.endsWith('…')).toBe(true);
  });

  it.each([
    'curl --token private-credential https://example.com',
    'curl --api-key "private-credential" https://example.com',
    'curl -H "Authorization: Bearer private-credential"',
    'curl https://alice:private-credential@example.com',
  ])('masks credentials before shortening command %s', (command) => {
    const detail = operationDetail({ command });
    expect(detail).toContain('curl');
    expect(detail).not.toContain('private-credential');
  });
});

describe('describeAgentStatus', () => {
  it('says what the agent is doing, for how long, and what it already did', () => {
    const text = describeAgentStatus({
      task: 'Uruchom testy w projekcie.',
      startedAt: 0,
      steps: 3,
      current: { kind: 'verification', detail: 'pnpm test' },
      done: ['project-read', 'editing'],
    }, 2 * MINUTE + 5_000);

    expect(text).toBe(
      'Progress of the running Moxxy task "Uruchom testy w projekcie." (running for 2 min): step 3, the agent is running checks or tests (pnpm test). Done so far: reading the project, editing files.',
    );
  });

  it('adds the agent plan when it keeps one', () => {
    const text = describeAgentStatus({
      task: 'Napraw lint.',
      startedAt: 0,
      steps: 1,
      current: { kind: 'editing', detail: 'app.ts' },
      done: [],
      plan: { done: 2, total: 5, current: 'Fix the lint errors' },
    }, 10_000);

    expect(text).toBe(
      'Progress of the running Moxxy task "Napraw lint." (running for under a minute): step 1, the agent is editing files (app.ts). Plan: 2 of 5 steps done, now: Fix the lint errors.',
    );
  });

  it('keeps the task words short', () => {
    const text = describeAgentStatus({ task: 'a'.repeat(300), startedAt: 0, steps: 1, done: [] }, 0);
    expect(text).toContain(`"${'a'.repeat(79)}…"`);
    expect(text).toContain('the agent is working on it.');
  });

  it('masks a key in the task and plan before sending status to the voice model', () => {
    const key = 'sk-proj-private-credential-123456789';
    const text = describeAgentStatus({
      task: `Configure ${key}`, startedAt: 0, steps: 1, done: [],
      plan: { done: 0, total: 1, current: `Verify ${key}` },
    }, 0);
    expect(text).toContain('Configure');
    expect(text).toContain('Verify');
    expect(text).not.toContain('private-credential');
  });
});

it('redacts keys and credential arguments from command status and understands cmd', () => {
  const detail = operationDetail({ cmd: 'OPENAI_API_KEY=sk-proj-secret pnpm test --token=secret-token' });
  expect(detail).toContain('pnpm test');
  expect(detail).not.toContain('sk-proj-secret');
  expect(detail).not.toContain('secret-token');
});
