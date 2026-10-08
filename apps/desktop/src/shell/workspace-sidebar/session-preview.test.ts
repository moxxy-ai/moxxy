import { describe, expect, it } from 'vitest';
import type { DeskSession } from '@moxxy/desktop-ipc-contract';
import { lastMessageText, sessionPreview } from './session-preview';

const session = (over: Partial<DeskSession> = {}): DeskSession => ({
  id: 's',
  name: 'Fix the login bug',
  createdAt: 1,
  ...over,
});

describe('sessionPreview', () => {
  it('shows the latest message when the conversation is loaded', () => {
    expect(sessionPreview(session(), 'Done.\n\nAll **156** tests pass.')).toBe(
      'Done. All 156 tests pass.',
    );
  });

  it('does not repeat the name: an untouched title is already the first prompt', () => {
    const s = session({ firstPrompt: 'Fix the login bug in the auth module', model: 'gpt-6-luna' });
    expect(sessionPreview(s, null)).toBe('gpt-6-luna');
  });

  it('shows the first prompt once the run has been renamed', () => {
    const s = session({ name: 'Auth work', firstPrompt: 'Fix the login\nbug' });
    expect(sessionPreview(s, null)).toBe('Fix the login bug');
  });

  it('says a new run is empty', () => {
    expect(sessionPreview(session({ name: 'New session', eventCount: 0 }), null)).toBe(
      'No messages yet',
    );
  });

  it('has nothing to say when the payload has nothing', () => {
    expect(sessionPreview(session({ eventCount: 12 }), null)).toBeNull();
  });
});

describe('lastMessageText', () => {
  it('takes the last thing either side said, and skips tool activity', () => {
    expect(
      lastMessageText([
        { type: 'user_prompt', text: 'run the tests' },
        { type: 'assistant_message', content: 'Nothing failed.' },
        { type: 'tool_call_requested' },
      ]),
    ).toBe('Nothing failed.');
    expect(lastMessageText([{ type: 'user_prompt', text: 'hello' }])).toBe('hello');
  });

  it('is null for an empty or tool-only log', () => {
    expect(lastMessageText([])).toBeNull();
    expect(lastMessageText([{ type: 'tool_result' }])).toBeNull();
  });
});
