import { act, cleanup, renderHook } from '@testing-library/react';
import { startTransition } from 'react';
import { flushSync } from 'react-dom';
import { afterEach, expect, it } from 'vitest';
import { useBrowserPanes } from './useBrowserPanes';

afterEach(cleanup);

const page = 'https://example.com/';

it('closes only the selected tab while another tab is opening at a lower priority', () => {
  const { result } = renderHook(useBrowserPanes);
  act(() => {
    result.current.openPane(page);
    result.current.openPane(page);
  });
  const [first, second, third] = result.current.panes;
  if (!first || !second || !third) throw new Error('expected three open tabs');
  result.current.noteAdoption(second.key, 'second');

  act(() => {
    startTransition(() => result.current.openAgentPane('fourth', page));
    flushSync(() => { result.current.closeHostedTab('second'); });
  });

  expect(result.current.panes.map((pane) => pane.key)).toEqual([first.key, third.key, 'agent-fourth']);
});

it('keeps a newly registered view when processing an earlier list of surviving tabs', () => {
  const { result } = renderHook(useBrowserPanes);
  act(() => {
    result.current.openPane(page);
    result.current.openPane(page);
  });
  const [first, second, third] = result.current.panes;
  if (!first || !second || !third) throw new Error('expected three open tabs');
  result.current.noteAdoption(first.key, 'first');
  result.current.noteAdoption(second.key, 'second');

  act(() => {
    result.current.openPane(page);
    result.current.reconcile([{ tabId: 'first', url: page, title: 'Same', active: true }]);
    result.current.noteAdoption(third.key, 'third');
  });

  expect(result.current.panes).toHaveLength(3);
  expect(result.current.panes.slice(0, 2)).toEqual([first, third]);
});
