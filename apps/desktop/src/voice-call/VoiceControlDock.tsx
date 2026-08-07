import { Icon } from '@moxxy/desktop-ui';

export function VoiceControlDock({
  microphoneMuted,
  waitingSoundEnabled,
  localPiperInstallRequired,
  localPiperInstalling,
  errorReason,
  onRetry,
  onInstallLocalPiper,
  onMuteMicrophone,
  onUnmuteMicrophone,
  onToggleWaitingSound,
}: {
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly errorReason: string | null;
  readonly onRetry: () => void;
  readonly onInstallLocalPiper: () => void;
  readonly onMuteMicrophone: () => void;
  readonly onUnmuteMicrophone: () => void;
  readonly onToggleWaitingSound: () => void;
}): JSX.Element {
  if (localPiperInstallRequired) {
    return (
      <div className="voice-control-dock voice-control-dock--install" role="alert">
        <span className="voice-control-dock-icon" aria-hidden="true"><Icon name="plug" size={18} /></span>
        <span className="voice-control-dock-copy">
          <strong>Local Piper</strong>
          <small>{errorReason && errorReason !== 'Local Piper is not installed.'
            ? errorReason
            : 'Install the private offline voice package to continue.'}</small>
        </span>
        <button
          type="button"
          onClick={onInstallLocalPiper}
          disabled={localPiperInstalling}
          aria-label={localPiperInstalling ? 'Installing Local Piper' : 'Install Local Piper'}
        >
          <Icon name={localPiperInstalling ? 'rotate' : 'plug'} size={16} />
          <span>{localPiperInstalling ? 'Installing...' : 'Install Local Piper'}</span>
        </button>
      </div>
    );
  }

  if (errorReason) {
    return (
      <div className="voice-control-dock voice-control-dock--error" role="alert">
        <span>{errorReason}</span>
        <button type="button" onClick={onRetry} aria-label="Try again">
          <Icon name="rotate" size={16} />
          <span>Try again</span>
        </button>
      </div>
    );
  }

  return (
    <div className="voice-control-dock" aria-label="Voice controls">
      <button
        type="button"
        className={microphoneMuted ? 'is-muted' : undefined}
        onClick={microphoneMuted ? onUnmuteMicrophone : onMuteMicrophone}
        aria-label={microphoneMuted ? 'Unmute microphone' : 'Mute microphone'}
        aria-pressed={microphoneMuted}
      >
        <span className="voice-control-dock-icon" aria-hidden="true"><Icon name="mic" size={18} /></span>
        <span className="voice-control-dock-copy">
          <strong>{microphoneMuted ? 'Microphone off' : 'Microphone on'}</strong>
          <small>{microphoneMuted ? 'Click to resume listening' : 'Listening locally'}</small>
        </span>
      </button>
      <span className="voice-control-dock-state" aria-hidden="true">
        <i /><i /><i /><i />
      </span>
      <button
        type="button"
        className={waitingSoundEnabled ? undefined : 'is-muted'}
        onClick={onToggleWaitingSound}
        aria-label={waitingSoundEnabled ? 'Turn waiting sound off' : 'Turn waiting sound on'}
        aria-pressed={waitingSoundEnabled}
      >
        <span className="voice-control-dock-icon" aria-hidden="true"><Icon name="speaker" size={18} /></span>
        <span className="voice-control-dock-copy">
          <strong>{waitingSoundEnabled ? 'Waiting sound on' : 'Waiting sound off'}</strong>
          <small>Local Piper</small>
        </span>
      </button>
    </div>
  );
}
