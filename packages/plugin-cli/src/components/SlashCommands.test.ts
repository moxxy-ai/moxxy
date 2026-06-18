import { describe, expect, it } from 'vitest';
import { matchSlash, type SlashCommand } from './SlashCommands.js';

// Fixed fixture so the ranking assertions don't depend on the live builtin list.
const FIXTURE: ReadonlyArray<SlashCommand> = [
  { name: 'model', description: 'switch model' },
  { name: 'mode', description: 'switch mode', aliases: ['loop'] },
  { name: 'mcp', description: 'mcp servers' },
  { name: 'yolo', description: 'auto-approve', aliases: ['auto-approve'] },
  { name: 'mod', description: 'exact-name collision target' },
];

const names = (cmds: SlashCommand[]): string[] => cmds.map((c) => c.name);

describe('matchSlash', () => {
  it('returns [] for input not starting with "/"', () => {
    expect(matchSlash('model', FIXTURE)).toEqual([]);
    expect(matchSlash('', FIXTURE)).toEqual([]);
  });

  it('returns all commands (capped to limit) for the empty needle "/"', () => {
    expect(names(matchSlash('/', FIXTURE))).toEqual(names([...FIXTURE]));
    expect(matchSlash('/', FIXTURE, 2)).toHaveLength(2);
    // Preserves catalog order.
    expect(names(matchSlash('/', FIXTURE, 2))).toEqual(['model', 'mode']);
  });

  it('ranks an exact name match ahead of longer prefix matches', () => {
    // "/mod" exactly matches `mod`; `model`/`mode` are prefix matches.
    expect(names(matchSlash('/mod', FIXTURE))).toEqual(['mod', 'model', 'mode']);
  });

  it('preserves catalog order within the prefix bucket', () => {
    // "/mo" prefixes model, mode, mod (all in catalog order).
    expect(names(matchSlash('/mo', FIXTURE))).toEqual(['model', 'mode', 'mod']);
  });

  it('places alias-only matches after name matches', () => {
    // "/loop" matches `mode` only via its alias → it ranks in the alias bucket.
    expect(names(matchSlash('/loop', FIXTURE))).toEqual(['mode']);
    // "/au" matches yolo via alias `auto-approve` only.
    expect(names(matchSlash('/au', FIXTURE))).toEqual(['yolo']);
  });

  it('is case-insensitive on the needle', () => {
    expect(names(matchSlash('/MOD', FIXTURE))).toEqual(['mod', 'model', 'mode']);
  });

  it('truncates results to the limit', () => {
    expect(matchSlash('/m', FIXTURE, 2)).toHaveLength(2);
    expect(names(matchSlash('/m', FIXTURE, 2))).toEqual(['model', 'mode']);
  });

  it('returns [] when nothing matches the needle', () => {
    expect(matchSlash('/zzz', FIXTURE)).toEqual([]);
  });
});
