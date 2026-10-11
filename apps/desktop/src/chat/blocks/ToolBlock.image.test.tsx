/** An image a tool returned (a screenshot an agent looks at) shows in the conversation. */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { asEventId, asSessionId, asToolCallId, asTurnId, type ToolResultEvent } from '@moxxy/sdk';
import { ImagePreviewProvider } from '../image-preview/ImagePreviewContext';
import { ToolRow } from '../SkillGroupView';
import { ToolBlock } from './ToolBlock';

const screenshot: ToolResultEvent = {
  id: asEventId('e2'),
  seq: 2,
  ts: 2,
  sessionId: asSessionId('s'),
  turnId: asTurnId('t'),
  type: 'tool_result',
  source: 'tool',
  callId: asToolCallId('c1'),
  ok: true,
  output: { forModel: 'Arc, tests.html', mediaType: 'image/jpeg', base64: '/9j/AAA' },
};

describe('an image in a tool result', () => {
  it('shows under the tool line and opens in the preview when clicked', () => {
    const open = vi.fn();
    render(
      <ImagePreviewProvider value={open}>
        <ToolBlock name="mcp__cua_repl__js" input={{ title: 'Oglądam testy w przeglądarce' }} outcome={screenshot} />
      </ImagePreviewProvider>,
    );

    const thumb = screen.getByRole('button', { name: /preview the image mcp__cua_repl__js returned/i });
    expect(thumb.querySelector('img')?.getAttribute('src')).toBe('data:image/jpeg;base64,/9j/AAA');
    fireEvent.click(thumb);
    expect(open).toHaveBeenCalledWith({ name: 'mcp__cua_repl__js', mediaType: 'image/jpeg', base64: '/9j/AAA' });
  });

  it('opens to the text the tool returned beside the image, never the image as text', () => {
    render(<ToolBlock name="view_image" input={{ path: '/repo/shot.png' }} outcome={screenshot} />);

    fireEvent.click(screen.getByRole('button', { name: /view_image|shot\.png/i, expanded: false }));

    expect(screen.getByText('Arc, tests.html')).toBeTruthy();
    expect(screen.queryByText(/9j\/AAA/)).toBeNull();
  });

  it('shows in a row of a tool group too', () => {
    render(
      <ul>
        <ToolRow tool={{ id: 'r', name: 'Read', input: { file_path: 'shot.png' }, outcome: screenshot, requestedAt: 1 }} />
      </ul>,
    );

    expect(screen.getByRole('button', { name: /preview the image read returned/i })).toBeTruthy();
  });
});
