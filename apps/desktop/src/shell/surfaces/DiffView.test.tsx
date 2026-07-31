import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiffView } from './DiffView';

describe('DiffView', () => {
  it('uses the changed file grammar inside semantic diff rows', async () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-const before = false;',
      '+const after = true;',
    ].join('\n');
    const { container } = render(<DiffView diff={diff} path="src/a.ts" />);

    await waitFor(() => expect(container.querySelector('.token.keyword')).not.toBeNull());
    expect(container.querySelectorAll('.diff-code__marker')).toHaveLength(2);
    expect(container.textContent).toContain('const after = true;');
  });
});
