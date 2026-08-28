import { useState } from 'react';
import type { VoiceCallPhase, VoiceOperationKind } from '@moxxy/client-core';
import { Icon, Modal, type IconName } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';
import type { VoiceModeStatus } from './useVoiceModePresentation';
import type { VoiceRailView } from './voice-rail';
import { VoiceRadioWaves } from './VoiceRadioWaves';
import { useVoicePulse } from './useVoicePulse';
import './voice-rail.css';

/** Size of the mark in the rail, in CSS pixels. */
const RAIL_MARK_SIZE = 34;

const OPERATION_ICON: Readonly<Record<VoiceOperationKind, IconName>> = Object.freeze({
  'web-search': 'globe',
  'project-read': 'file',
  editing: 'pencil',
  verification: 'check',
  command: 'terminal',
  application: 'grid',
  delegation: 'agent',
  generic: 'spark',
});

/**
 * Voice Mode as one line inside the ordinary chat surface.
 *
 * It replaces a full-screen stage: the header, transcript, ask sheet and text
 * composer all stay exactly where they were, so a voice conversation is the
 * same conversation with a microphone open — a person can still read back,
 * search, click a tool result, and type.
 *
 * Purely presentational. Status, operation selection and dwell timing are
 * decided upstream; this renders what it is handed.
 */
export function VoicePresenceRail({
  phase,
  status,
  rail,
  microphoneMuted,
  waitingSoundEnabled,
  localPiperInstallRequired,
  localPiperInstalling,
  errorReason,
  inputAnalyser,
  outputAnalyser,
  onRetry,
  onInstallLocalPiper,
  onMuteMicrophone,
  onUnmuteMicrophone,
  onToggleWaitingSound,
  onClose,
}: {
  readonly phase: VoiceCallPhase;
  readonly status: VoiceModeStatus;
  readonly rail: VoiceRailView;
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly errorReason: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly onRetry: () => void;
  readonly onInstallLocalPiper: () => void;
  readonly onMuteMicrophone: () => void;
  readonly onUnmuteMicrophone: () => void;
  readonly onToggleWaitingSound: () => void;
  readonly onClose: () => void;
}): JSX.Element {
  const pulseRef = useVoicePulse({ phase, inputAnalyser, outputAnalyser });
  const [showInstallDetails, setShowInstallDetails] = useState(false);
  const failed = phase === 'error';
  const voiceCarrying = phase === 'listening' || phase === 'speaking';

  return (
    <section
      ref={pulseRef}
      className={`voice-rail voice-rail--${phase}${microphoneMuted ? ' is-muted' : ''}`}
      aria-label="Voice mode"
    >
      <div className="voice-rail-presence">
        <VoiceRadioWaves side="left" active={voiceCarrying} />
        <span className="voice-rail-mark" aria-hidden="true">
          <MoxxyMark size={RAIL_MARK_SIZE} />
          <span className="voice-rail-halo" />
        </span>
        <VoiceRadioWaves side="right" active={voiceCarrying} />
        <span className="voice-rail-copy">
          <strong role="status" aria-live="polite">{status.title}</strong>
          <small>{status.detail}</small>
        </span>
      </div>

      <div className="voice-rail-work">
        {localPiperInstallRequired && failed ? (
          <>
            <span className="voice-rail-work-copy voice-rail-work-copy--error">
              <strong role="alert">Couldn't install local voice</strong>
              <small>Check your connection and try again.</small>
            </span>
            {errorReason && (
              <button
                type="button"
                className="voice-rail-action"
                onClick={() => setShowInstallDetails(true)}
              >
                Technical details
              </button>
            )}
            <button type="button" className="voice-rail-action" onClick={onInstallLocalPiper}>
              Try again
            </button>
          </>
        ) : localPiperInstallRequired ? (
          <>
            <span className="voice-rail-work-copy">
              <strong>{localPiperInstalling ? 'Installing local voice' : 'Local voice required'}</strong>
              <small>{localPiperInstalling ? 'Downloading the offline package' : 'Install Local Piper once to use Voice Mode'}</small>
            </span>
            <button
              type="button"
              className="voice-rail-action"
              onClick={onInstallLocalPiper}
              disabled={localPiperInstalling}
            >
              {localPiperInstalling ? 'Installing…' : 'Install Local Piper'}
            </button>
          </>
        ) : failed ? (
          <>
            <span className="voice-rail-work-copy voice-rail-work-copy--error">
              <strong>Voice mode stopped</strong>
              <small>{errorReason ?? 'Resolve the issue and try again.'}</small>
            </span>
            <button type="button" className="voice-rail-action" onClick={onRetry}>Try again</button>
          </>
        ) : rail.operation ? (
          <span
            className={`voice-rail-operation is-${rail.operation.state}`}
            data-testid="voice-rail-operation"
          >
            <span className="voice-rail-operation-icon" aria-hidden="true">
              <Icon name={OPERATION_ICON[rail.operation.kind]} size={15} />
            </span>
            <span className="voice-rail-operation-label">{rail.operation.label}</span>
            {rail.operation.state === 'running' && (
              <span className="voice-rail-operation-dots" aria-hidden="true">
                <i /><i /><i /><i />
              </span>
            )}
            <span className="voice-rail-operation-state">
              {rail.operation.state === 'running' ? 'IN PROGRESS' : rail.operation.state.toUpperCase()}
            </span>
            {rail.overflowCount > 0 && (
              <span className="voice-rail-operation-more">+{rail.overflowCount} active</span>
            )}
          </span>
        ) : (
          /* The slot keeps its shape when nothing is running. An empty column
             behind a hairline reads as something failing to load; a quiet line
             reads as "nothing to report", which is the truth. */
          <span className="voice-rail-operation voice-rail-operation--idle" data-testid="voice-rail-idle">
            <span className="voice-rail-operation-icon" aria-hidden="true">
              <Icon name="spark" size={15} />
            </span>
            <span className="voice-rail-operation-label">No tools running</span>
          </span>
        )}
      </div>

      <div className="voice-rail-controls">
        <button
          type="button"
          className={`voice-rail-control${microphoneMuted ? ' is-off' : ''}`}
          aria-pressed={!microphoneMuted}
          aria-label={microphoneMuted ? 'Turn the microphone on' : 'Turn the microphone off'}
          onClick={microphoneMuted ? onUnmuteMicrophone : onMuteMicrophone}
        >
          <Icon name="mic" size={16} />
          <span>{microphoneMuted ? 'Microphone off' : 'Microphone on'}</span>
        </button>
        <button
          type="button"
          className={`voice-rail-control${waitingSoundEnabled ? '' : ' is-off'}`}
          aria-pressed={waitingSoundEnabled}
          aria-label={waitingSoundEnabled ? 'Turn the waiting sound off' : 'Turn the waiting sound on'}
          onClick={onToggleWaitingSound}
        >
          <Icon name="speaker" size={16} />
          <span>{waitingSoundEnabled ? 'Waiting sound on' : 'Waiting sound off'}</span>
        </button>
      </div>

      <button
        type="button"
        className="voice-rail-end"
        aria-label="End voice mode"
        onClick={onClose}
      >
        End voice
      </button>

      {showInstallDetails && errorReason && (
        <Modal
          title="Voice installation details"
          width={560}
          onClose={() => setShowInstallDetails(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p style={{ margin: 0, color: 'var(--color-text-dim)' }}>
              Copy these details when reporting the problem. They stay hidden during normal use.
            </p>
            <pre
              style={{
                margin: 0,
                padding: 12,
                overflow: 'auto',
                border: '1px solid var(--color-card-border)',
                borderRadius: 'var(--radius-card)',
                background: 'var(--color-code-bg)',
                color: 'var(--color-text)',
                fontSize: 'var(--type-meta)',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                userSelect: 'text',
              }}
            >
              {errorReason}
            </pre>
          </div>
        </Modal>
      )}
    </section>
  );
}
