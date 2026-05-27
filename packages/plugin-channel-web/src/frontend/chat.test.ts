import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChatPanel } from './chat.js';
import type { TranscriptMessage } from './socket.js';

const noop = (): void => undefined;
const render = (messages: TranscriptMessage[], status: { text: string; error: boolean } | null = null): string =>
  renderToStaticMarkup(createElement(ChatPanel, { messages, status, onSend: noop, onClose: noop }));

describe('ChatPanel', () => {
  it('shows a hint + the input when empty', () => {
    const html = render([]);
    expect(html).toContain('Chat with the agent');
    expect(html).toMatch(/add a price filter/);
    expect(html).toContain('placeholder="Ask for changes');
  });

  it('renders user and assistant messages distinctly', () => {
    const html = render([
      { role: 'user', text: 'add a price filter' },
      { role: 'assistant', text: 'Done — filtered by price.' },
    ]);
    expect(html).toContain('add a price filter');
    expect(html).toContain('Done — filtered by price.');
    expect(html).toContain('chat-msg user');
    expect(html).toContain('chat-msg assistant');
  });

  it('shows working / error status', () => {
    expect(render([], { text: 'working…', error: false })).toContain('working');
    const err = render([], { text: 'boom', error: true });
    expect(err).toContain('chat-status err');
    expect(err).toContain('boom');
  });
});
