import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './composer';

describe('<Composer />', () => {
  it('disables Send when not ready', () => {
    render(
      <Composer
        ready={false}
        activeTurnId={null}
        onSend={() => {}}
        onAbort={() => {}}
      />,
    );
    expect(screen.getByTestId('composer-send')).toBeDisabled();
    expect(screen.getByTestId('composer-input')).toBeDisabled();
  });

  it('enables Send only when there is non-whitespace text', async () => {
    render(
      <Composer
        ready
        activeTurnId={null}
        onSend={() => {}}
        onAbort={() => {}}
      />,
    );
    const input = screen.getByTestId('composer-input');
    expect(screen.getByTestId('composer-send')).toBeDisabled();
    await userEvent.type(input, '   ');
    expect(screen.getByTestId('composer-send')).toBeDisabled();
    await userEvent.type(input, 'hello');
    expect(screen.getByTestId('composer-send')).not.toBeDisabled();
  });

  it('submits and clears on click', async () => {
    const onSend = vi.fn();
    render(
      <Composer ready activeTurnId={null} onSend={onSend} onAbort={() => {}} />,
    );
    const input = screen.getByTestId('composer-input');
    await userEvent.type(input, 'hi');
    await userEvent.click(screen.getByTestId('composer-send'));
    expect(onSend).toHaveBeenCalledWith('hi');
    expect(input).toHaveValue('');
  });

  it('submits on ⌘↵', async () => {
    const onSend = vi.fn();
    render(
      <Composer ready activeTurnId={null} onSend={onSend} onAbort={() => {}} />,
    );
    const input = screen.getByTestId('composer-input');
    await userEvent.type(input, 'hi');
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('submits on Ctrl+Enter for non-mac users', async () => {
    const onSend = vi.fn();
    render(
      <Composer ready activeTurnId={null} onSend={onSend} onAbort={() => {}} />,
    );
    const input = screen.getByTestId('composer-input');
    await userEvent.type(input, 'hi');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(onSend).toHaveBeenCalledWith('hi');
  });

  it('Enter alone inserts a newline (no submit)', async () => {
    const onSend = vi.fn();
    render(
      <Composer ready activeTurnId={null} onSend={onSend} onAbort={() => {}} />,
    );
    const input = screen.getByTestId('composer-input');
    await userEvent.type(input, 'a{Enter}b');
    expect(onSend).not.toHaveBeenCalled();
    expect(input).toHaveValue('a\nb');
  });

  it('Esc clears the draft', async () => {
    render(
      <Composer
        ready
        activeTurnId={null}
        onSend={() => {}}
        onAbort={() => {}}
      />,
    );
    const input = screen.getByTestId('composer-input');
    await userEvent.type(input, 'half written');
    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('');
  });

  it('swaps Send for Abort while a turn is in flight', async () => {
    const onAbort = vi.fn();
    render(
      <Composer ready activeTurnId="T-1" onSend={() => {}} onAbort={onAbort} />,
    );
    expect(screen.queryByTestId('composer-send')).toBeNull();
    const abort = screen.getByTestId('composer-abort');
    await userEvent.click(abort);
    expect(onAbort).toHaveBeenCalled();
  });

  it('shows the character count', async () => {
    render(
      <Composer
        ready
        activeTurnId={null}
        onSend={() => {}}
        onAbort={() => {}}
      />,
    );
    const input = screen.getByTestId('composer-input');
    await userEvent.type(input, 'hello');
    expect(screen.getByTestId('composer-hint')).toHaveTextContent('5 chars');
  });
});
