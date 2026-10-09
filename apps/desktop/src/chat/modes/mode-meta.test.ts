import { describe, expect, it } from 'vitest';
import { modeMeta } from './mode-meta';

/** How a mode is named and explained wherever the desktop shows one. */

describe('modeMeta', () => {
  it('names the built-in modes and says what each does', () => {
    expect(modeMeta('default')).toMatchObject({ label: 'Default', hint: 'Asks before it acts' });
    expect(modeMeta('plan')).toMatchObject({ label: 'Plan', hint: 'Reads only, then writes a plan', note: 'read-only' });
    expect(modeMeta('goal')).toMatchObject({ label: 'Goal', hint: 'Works unattended until it is done', note: 'unattended', tone: 'warn' });
    expect(modeMeta('research')).toMatchObject({ label: 'Research', hint: 'Researches in parallel, then writes a cited report' });
  });

  it('tells the field what to ask for in a mode that wants something particular', () => {
    expect(modeMeta('plan').placeholder).toBe('Describe what to plan…');
    expect(modeMeta('research').placeholder).toBe('Ask a research question…');
    expect(modeMeta('default').placeholder).toBeUndefined();
  });

  it('gives a mode it has never heard of its own name, tidied', () => {
    expect(modeMeta('plan-execute')).toEqual({ label: 'Plan execute', hint: '' });
    expect(modeMeta('bmad')).toEqual({ label: 'Bmad', hint: '' });
  });
});
