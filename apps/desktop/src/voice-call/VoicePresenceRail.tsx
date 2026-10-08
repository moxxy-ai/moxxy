import { useState, type CSSProperties } from 'react';
import type { VoiceCallPhase, VoiceOperationKind } from '@moxxy/client-core';
import { Icon, Modal, type IconName } from '@moxxy/desktop-ui';
import { MoxxyMark } from '@/components/MoxxyMark';
import { ClippedText } from '@/components/tip/ClippedText';
import { useElementWidth } from '@/lib/useElementWidth';
import type { VoiceModeStatus } from './useVoiceModePresentation';
import type { VoiceRailView } from './voice-rail';
import { VoiceRadioWaves } from './VoiceRadioWaves';
import { useVoicePulse } from './useVoicePulse';
import type { VoiceAgentWork } from './voice-agent-work';
import './voice-rail.css';

/** Size of the mark in the rail, in CSS pixels. */
const RAIL_MARK_SIZE = 28;

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

/** A finished operation's state as a word; a running one reads "In progress". */
function stateLabel(state: string): string {
  if (state === 'running') return 'In progress';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

/**
 * Voice Mode as one card inside the ordinary chat surface, above the composer.
 *
 * It replaces a full-screen stage: the header, transcript, ask sheet and text
 * composer all stay exactly where they were, so a voice conversation is the
 * same conversation with a microphone open — a person can still read back,
 * search, click a tool result, and type.
 *
 * At rest the card is cut down to a capsule around its state, the way a
 * notch holds a call: the work and the controls are to its sides, and show
 * under the pointer, under the keyboard, and whenever the call needs the
 * person. The cut is the stylesheet's; this hands it the capsule's width.
 *
 * Purely presentational. Status, operation selection and dwell timing are
 * decided upstream; this renders what it is handed.
 */
export function VoicePresenceRail({
  phase,
  status,
  rail,
  microphoneMuted,
  localPiperInstallRequired,
  localPiperInstalling,
  localPiperInstallError,
  errorReason,
  inputAnalyser,
  outputAnalyser,
  onRetry,
  onInstallLocalPiper,
  onMuteMicrophone,
  onUnmuteMicrophone,
  onClose,
  agentWork = null,
}: {
  readonly phase: VoiceCallPhase;
  readonly status: VoiceModeStatus;
  readonly rail: VoiceRailView;
  readonly microphoneMuted: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly localPiperInstallError: string | null;
  readonly errorReason: string | null;
  readonly inputAnalyser: unknown | null;
  readonly outputAnalyser: unknown | null;
  readonly onRetry: () => void;
  readonly onInstallLocalPiper: () => void;
  readonly onMuteMicrophone: () => void;
  readonly onUnmuteMicrophone: () => void;
  readonly onClose: () => void;
  /** What the agent is doing while no tool runs; null when it is idle. */
  readonly agentWork?: VoiceAgentWork | null;
}): JSX.Element {
  const pulseRef = useVoicePulse({ phase, inputAnalyser, outputAnalyser });
  const capsule = useElementWidth<HTMLDivElement>();
  const [showInstallDetails, setShowInstallDetails] = useState(false);
  const failed = phase === 'error';
  const voiceCarrying = phase === 'listening' || phase === 'speaking';
  const needsPerson = failed || localPiperInstallRequired || localPiperInstalling;
  const busy = agentWork !== null || (rail.operation !== null && rail.operation.state === 'running');

  return (
    <section
      ref={pulseRef}
      className={`voice-rail voice-rail--${phase}${microphoneMuted ? ' is-muted' : ''}`}
      aria-label="Voice mode"
      data-open={needsPerson ? 'true' : undefined}
      style={capsule.width === null ? undefined : ({ '--voice-capsule': `${capsule.width}px` } as CSSProperties)}
    >
      <div className="voice-rail-body">
        <div className="voice-rail-side voice-rail-work">
          {localPiperInstalling ? (
            <>
              <span className="voice-rail-work-copy">
                <strong>Installing local voice</strong>
                <small>Downloading the offline package</small>
              </span>
              <button type="button" className="voice-rail-action" disabled>
                Installing…
              </button>
            </>
          ) : localPiperInstallRequired && localPiperInstallError ? (
            <>
              <span className="voice-rail-work-copy voice-rail-work-copy--error">
                <strong role="alert">Couldn't install local voice</strong>
                <small>Check your connection and try again.</small>
              </span>
              <button
                type="button"
                className="voice-rail-action"
                onClick={() => setShowInstallDetails(true)}
              >
                Technical details
              </button>
              <button type="button" className="voice-rail-action" onClick={onInstallLocalPiper}>
                Try again
              </button>
            </>
          ) : localPiperInstallRequired ? (
            <>
              <span className="voice-rail-work-copy">
                <strong>Local voice required</strong>
                <small>Install Local Piper once to use Voice Mode</small>
              </span>
              <button
                type="button"
                className="voice-rail-action"
                onClick={onInstallLocalPiper}
              >
                Install Local Piper
              </button>
            </>
          ) : failed ? (
            <>
              {/* The capsule beside it already says the call stopped; this is why. */}
              <ClippedText
                className="voice-rail-reason"
                role="alert"
                text={errorReason ?? 'Resolve the issue and try again.'}
              />
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
              {/* Running, the capsule's dots say it; the word stays for a screen reader. */}
              <span
                className={`voice-rail-operation-state${rail.operation.state === 'running' ? ' sr-only' : ''}`}
              >
                {stateLabel(rail.operation.state)}
              </span>
              {rail.overflowCount > 0 && (
                <span className="voice-rail-operation-more">+{rail.overflowCount} active</span>
              )}
            </span>
          ) : (
            /* Nothing running: the slot says what the phase means, so it is
               never an empty column and never a line about tools that are not there. */
            <span className="voice-rail-operation voice-rail-operation--idle" data-testid="voice-rail-idle">
              <ClippedText
                className="voice-rail-operation-label"
                text={
                  agentWork ? `${agentWork.label}${agentWork.elapsed ? ` · ${agentWork.elapsed}` : ''}` : status.detail
                }
              />
            </span>
          )}
        </div>

        <div ref={capsule.ref} className="voice-rail-presence">
          <VoiceRadioWaves side="left" active={voiceCarrying} variant="compact" />
          <span className="voice-rail-mark" aria-hidden="true">
            <MoxxyMark size={RAIL_MARK_SIZE} />
            <span className="voice-rail-halo" />
          </span>
          <VoiceRadioWaves side="right" active={voiceCarrying} variant="compact" />
          <span className="voice-rail-copy">
            <strong role="status" aria-live="polite">{status.title}</strong>
          </span>
          {busy && (
            <span className="voice-rail-busy voice-rail-operation-dots" aria-hidden="true">
              <i /><i /><i /><i />
            </span>
          )}
        </div>

        <div className="voice-rail-side voice-rail-controls">
          <button
            type="button"
            className={`voice-rail-control tip${microphoneMuted ? ' is-off' : ''}`}
            aria-pressed={!microphoneMuted}
            aria-label={microphoneMuted ? 'Turn the microphone on' : 'Turn the microphone off'}
            // The control is an icon, so its tooltip says the state it is in.
            data-tip={microphoneMuted ? 'Microphone off' : 'Microphone on'}
            data-tip-side="top"
            onClick={microphoneMuted ? onUnmuteMicrophone : onMuteMicrophone}
          >
            <Icon name="mic" size={16} />
          </button>
          <button
            type="button"
            className="voice-rail-end"
            aria-label="End voice mode"
            onClick={onClose}
          >
            <Icon name="phone-down" size={15} />
            End
          </button>
        </div>
      </div>

      {showInstallDetails && localPiperInstallError && (
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
              {localPiperInstallError}
            </pre>
          </div>
        </Modal>
      )}
    </section>
  );
}
