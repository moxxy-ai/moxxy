import { describe, expect, it } from 'vitest';
import type { AppSetupState } from '@moxxy/desktop-ipc-contract';
import { StartupSetup } from './setup.js';

function tracked() {
  const seen: AppSetupState[] = [];
  return { seen, setup: new StartupSetup({ onChange: (state) => seen.push(state) }) };
}
const statuses = (state: AppSetupState) => state.steps.map((step) => `${step.id}:${step.status}`);

describe('StartupSetup', () => {
  it('has nothing to show on a launch with nothing to set up', async () => {
    const { seen, setup } = tracked();
    setup.begin(null, []);

    expect(await setup.step('extensions', async () => 'seeded')).toBe('seeded');
    setup.finish();

    expect(seen).toEqual([{ reason: null, phase: 'done', steps: [], notes: [] }]);
  });

  it('lists the steps up front, before any of them runs', () => {
    const { setup } = tracked();
    setup.begin('update', ['extensions', 'components']);

    expect(setup.snapshot()).toEqual({
      reason: 'update',
      phase: 'pending',
      steps: [
        { id: 'extensions', status: 'pending' },
        { id: 'components', status: 'pending' },
      ],
      notes: [],
    });
  });

  it('moves through the steps and reports each change', async () => {
    const { seen, setup } = tracked();
    setup.begin('update', ['extensions', 'components']);

    await setup.step('extensions', async () => undefined);
    await setup.step('components', async () => undefined);
    setup.finish();

    expect(seen.map(statuses)).toEqual([
      ['extensions:running', 'components:pending'],
      ['extensions:done', 'components:pending'],
      ['extensions:done', 'components:running'],
      ['extensions:done', 'components:done'],
      ['extensions:done', 'components:done'],
    ]);
    expect(seen.at(0)?.phase).toBe('running');
    expect(seen.at(-1)?.phase).toBe('done');
  });

  it('records a step that fails, says so, and carries on with the next', async () => {
    const { setup } = tracked();
    setup.begin('update', ['extensions', 'components']);

    const result = await setup.step('extensions', async () => {
      throw new Error('disk full');
    });
    await setup.step('components', async () => undefined);
    setup.finish();

    expect(result).toBeUndefined();
    expect(setup.snapshot().steps).toEqual([
      { id: 'extensions', status: 'failed', error: 'disk full' },
      { id: 'components', status: 'done' },
    ]);
  });

  it('keeps what a person should know afterwards', () => {
    const { setup } = tracked();
    setup.begin('update', ['connections']);

    setup.note('ChatGPT sign-in was replaced; the previous copy is in /backup.');

    expect(setup.snapshot().notes).toEqual(['ChatGPT sign-in was replaced; the previous copy is in /backup.']);
  });

  it('closes any step still open when the launch stops setting up', () => {
    const { setup } = tracked();
    setup.begin('install', ['extensions', 'components']);

    setup.finish();

    expect(setup.snapshot()).toMatchObject({ phase: 'done', steps: [{ status: 'done' }, { status: 'done' }] });
  });
});
