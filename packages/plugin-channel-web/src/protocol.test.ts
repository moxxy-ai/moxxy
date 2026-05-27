import { describe, expect, it } from 'vitest';
import { actionPrompt } from './protocol.js';

describe('actionPrompt', () => {
  it('embeds the action + values as a fenced [ui-action] block', () => {
    const p = actionPrompt({ name: 'search_flights' }, { from: 'SFO', to: 'JFK' });
    expect(p).toContain('[ui-action]');
    expect(p).toContain('```json');
    const json = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as { action: string; values: Record<string, string> };
    expect(parsed.action).toBe('search_flights');
    expect(parsed.values).toEqual({ from: 'SFO', to: 'JFK' });
  });

  it('includes params when present and is round-trippable JSON', () => {
    const p = actionPrompt({ name: 'select', params: { id: 'UA42' } }, {});
    const json = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    const parsed = JSON.parse(json) as { action: string; params: Record<string, unknown>; values: unknown };
    expect(parsed.params).toEqual({ id: 'UA42' });
    expect(parsed.values).toEqual({});
  });

  it('omits params key when absent', () => {
    const p = actionPrompt({ name: 'x' }, { a: '1' });
    const json = p.slice(p.indexOf('{'), p.lastIndexOf('}') + 1);
    expect(JSON.parse(json)).not.toHaveProperty('params');
  });
});
