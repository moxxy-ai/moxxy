import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setApiOverride } from '@moxxy/client-core';
import { ATTACHMENT_LIMITS } from '@moxxy/desktop-ipc-contract';
import { Composer } from './Composer';
import { emitDroppedFiles } from './composer/dropped-files';
import type { AgentSession } from './agent-picker/useAgentSession';
import type { SessionInfo } from './agent-picker/types';

/**
 * A file dropped on the chat shows above the field as a chip, or as an alert
 * that says why it could not be attached. Nothing goes missing in silence.
 */

const WORKSPACE = 'w-attach';
const agent: AgentSession = {
  info: { activeProvider: 'p', activeMode: 'default', skills: [], commands: [] } as unknown as SessionInfo,
  selectedModel: null,
  modes: ['default'],
  onMode: () => {},
  onPickProviderModel: async () => {},
};

beforeEach(() => {
  // The IPC boundary: there is no Electron main here.
  __setApiOverride({
    invoke: async (name: string, args: { name?: string }) =>
      name === 'session.saveAttachment' ? { path: `/tmp/moxxy/${args.name}`, name: args.name } : undefined,
    subscribe: () => () => {},
  } as never);
});

afterEach(() => {
  cleanup();
  __setApiOverride(null);
});

function renderComposer(): void {
  render(
    <Composer
      agent={agent}
      ready
      sending={false}
      compacting={false}
      activeTurnId={null}
      workspaceId={WORKSPACE}
      onOpenVoiceCall={() => {}}
      onSend={() => {}}
      onAbort={() => {}}
    />,
  );
}

function tooLarge(): File {
  const file = new File(['x'], 'holiday.png', { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: ATTACHMENT_LIMITS.imageBytes + 1 });
  return file;
}

describe('Composer with a dropped file', () => {
  it('shows a dropped file as a chip above the field', async () => {
    renderComposer();

    act(() => emitDroppedFiles({ files: [new File(['a,b'], 'figures.csv', { type: 'text/csv' })], folders: [] }));

    expect(await screen.findByText('@figures.csv')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('raises an alert that names the file, its size and the limit when it is too large', async () => {
    renderComposer();

    act(() => emitDroppedFiles({ files: [tooLarge()], folders: [] }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('holiday.png is 8.1 MB. An image can be up to 8 MB.');
    expect(screen.queryByText('@holiday.png')).toBeNull();
  });

  it('keeps the alert until it is dismissed', async () => {
    renderComposer();
    act(() => emitDroppedFiles({ files: [tooLarge()], folders: [] }));
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});
