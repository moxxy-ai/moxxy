/**
 * Stage 2: active — the 232×56 (or 196×56 without a mic) pill with the
 * brand button plus the voice / text / restore-main / close actions.
 *
 * Presentational: voice capture is owned by the FocusWidget orchestrator
 * (so an in-flight transcription survives the switch to mini-text that
 * happens on stop). This component just reflects the recording state and
 * paints the in-place SpectroBackground visualiser while recording.
 */

import { api } from '@moxxy/client-core';
import { ActionButton, Dot, LogoMark } from './focus-primitives';
import { MicIcon, PencilIcon, WindowIcon, XIcon } from './focus-icons';
import { SpectroBackground } from './SpectroBackground';
import { style } from './focus-styles';

export function Active({
  hasTranscriber,
  recording,
  transcribing,
  analyser,
  onToggleMic,
  onCollapse,
  onText,
}: {
  readonly hasTranscriber: boolean;
  readonly recording: boolean;
  readonly transcribing: boolean;
  readonly analyser: AnalyserNode | null;
  readonly onToggleMic: () => void;
  readonly onCollapse: () => void;
  readonly onText: () => void;
}): JSX.Element {
  return (
    <div style={style.activeRoot}>
      {analyser && recording && <SpectroBackground analyser={analyser} />}
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse"
        style={style.activeBrand}
      >
        <LogoMark size={26} />
      </button>
      <div style={style.activeDivider} aria-hidden />
      <div style={style.activeActions}>
        {hasTranscriber && (
          <ActionButton
            onClick={onToggleMic}
            aria-label={recording ? 'Stop recording' : 'Record voice'}
          >
            {transcribing ? <Dot delay={0} /> : <MicIcon />}
          </ActionButton>
        )}
        <ActionButton onClick={onText} aria-label="Text">
          <PencilIcon />
        </ActionButton>
        {/* Dismiss the floating bar (leaves the app where it was — does NOT
            open the main window). Kept before the restore button so the LAST
            icon is the "open main window" action. */}
        <ActionButton
          onClick={() => void api().invoke('focus.close').catch(() => undefined)}
          aria-label="Close focus mode"
          variant="danger"
        >
          <XIcon />
        </ActionButton>
        {/* Last icon: reopen the full app (restores + focuses the main window
            and closes this bar). */}
        <ActionButton
          onClick={() => void api().invoke('focus.restoreMain').catch(() => undefined)}
          aria-label="Open main window"
        >
          <WindowIcon />
        </ActionButton>
      </div>
    </div>
  );
}
