import { describe, expect, it } from 'vitest';
import { askBrowserFor, onBrowserRequest, takeBrowserRequests } from './browser-link-requests';

describe('browser link requests (a chat link waiting for the browser pane)', () => {
  it('keeps an address until the pane takes it, then forgets it', () => {
    askBrowserFor({ requestId: 'r1', url: 'https://a.b' });
    expect(takeBrowserRequests()).toEqual(['https://a.b']);
    expect(takeBrowserRequests()).toEqual([]);
  });

  it('takes one click once, even when two chats hear it', () => {
    let heard = 0;
    const off = onBrowserRequest(() => void (heard += 1));
    askBrowserFor({ requestId: 'r2', url: 'https://c.d' });
    askBrowserFor({ requestId: 'r2', url: 'https://c.d' });
    off();
    expect(heard).toBe(1);
    expect(takeBrowserRequests()).toEqual(['https://c.d']);
  });
});
