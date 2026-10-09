import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VoicePresenceRail } from './VoicePresenceRail';

/**
 * A voice conversation is the same conversation with a microphone open, so
 * its bar is made like the things around it: a card on the composer's
 * measure, round controls, a pill to end it, labels in sentence case.
 */

afterEach(cleanup);

function renderRail(overrides: Partial<Parameters<typeof VoicePresenceRail>[0]> = {}): void {
  render(
    <VoicePresenceRail
      phase="listening"
      status={{ title: 'Listening', detail: 'Speak naturally. You can still type.' }}
      rail={{ operation: null, overflowCount: 0, nextExpiry: null }}
      microphoneMuted={false}
      localPiperInstallRequired={false}
      localPiperInstalling={false}
      localPiperInstallError={null}
      errorReason={null}
      inputAnalyser={null}
      outputAnalyser={null}
      onRetry={() => {}}
      onInstallLocalPiper={() => {}}
      onMuteMicrophone={() => {}}
      onUnmuteMicrophone={() => {}}
      onClose={() => {}}
      {...overrides}
    />,
  );
}

describe('VoicePresenceRail look', () => {
  it('says the state of each control in its tooltip, since the control is an icon', () => {
    renderRail();
    expect(screen.getByRole('button', { name: 'Turn the microphone off' })).toHaveAttribute('data-tip', 'Microphone on');
    expect(screen.getByRole('button', { name: 'End voice mode' })).toHaveTextContent('End');
  });

  it('reports a running operation in sentence case', () => {
    renderRail({
      rail: {
        operation: { callId: 'a', kind: 'command', label: 'Running commands', slot: 0, state: 'running' },
        overflowCount: 0,
        nextExpiry: null,
      },
    });
    const operation = screen.getByTestId('voice-rail-operation');
    expect(operation).toHaveTextContent('In progress');
    expect(operation.textContent).not.toMatch(/IN PROGRESS/);
  });

  it('shows a running operation with its dots and keeps the word for a screen reader', () => {
    renderRail({
      rail: {
        operation: { callId: 'a', kind: 'command', label: 'Running commands', slot: 0, state: 'running' },
        overflowCount: 0,
        nextExpiry: null,
      },
    });
    expect(screen.getByText('In progress')).toHaveClass('sr-only');
  });

  it('shows how a finished operation ended as a word', () => {
    renderRail({
      rail: {
        operation: { callId: 'a', kind: 'command', label: 'Running commands', slot: 0, state: 'failed' },
        overflowCount: 0,
        nextExpiry: null,
      },
    });
    expect(screen.getByText('Failed')).not.toHaveClass('sr-only');
  });
});
