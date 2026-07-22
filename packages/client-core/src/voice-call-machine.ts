export type VoiceCallPhase =
  | 'idle'
  | 'checking'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'working'
  | 'waiting-for-input'
  | 'synthesizing'
  | 'speaking'
  | 'paused'
  | 'error';

export interface VoiceCallState {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly errorReason: string | null;
  readonly microphoneMuted: boolean;
}

export type VoiceCallEvent =
  | { readonly type: 'open' }
  | { readonly type: 'ready' }
  | { readonly type: 'transcribing' }
  | { readonly type: 'transcript-ready' }
  | { readonly type: 'turn-started' }
  | { readonly type: 'tool-started' }
  | { readonly type: 'input-required' }
  | { readonly type: 'input-resolved' }
  | { readonly type: 'synthesizing' }
  | { readonly type: 'speaking' }
  | {
      readonly type: 'speech-finished';
      readonly resume: 'thinking' | 'working' | 'waiting-for-input';
    }
  | { readonly type: 'turn-settled' }
  | { readonly type: 'mute-microphone' }
  | { readonly type: 'unmute-microphone' }
  | { readonly type: 'failed'; readonly reason: string }
  | { readonly type: 'retry' }
  | { readonly type: 'close' };

const IDLE_STATE: VoiceCallState = Object.freeze({
  active: false,
  phase: 'idle',
  errorReason: null,
  microphoneMuted: false,
});

export function createVoiceCallState(): VoiceCallState {
  return IDLE_STATE;
}

function activeState(phase: VoiceCallPhase, microphoneMuted = false): VoiceCallState {
  return { active: true, phase, errorReason: null, microphoneMuted };
}

/** Pure lifecycle for a half-duplex call. Resource ownership stays in the hook. */
export function reduceVoiceCall(
  state: VoiceCallState,
  event: VoiceCallEvent,
): VoiceCallState {
  if (event.type === 'open') return activeState('checking');
  if (event.type === 'close') return IDLE_STATE;
  if (!state.active) return state;

  switch (event.type) {
    case 'ready':
      return activeState(state.microphoneMuted ? 'paused' : 'listening', state.microphoneMuted);
    case 'transcribing':
      return activeState('transcribing', state.microphoneMuted);
    case 'transcript-ready':
    case 'turn-started':
    case 'input-resolved':
      return activeState('thinking', state.microphoneMuted);
    case 'tool-started':
      return activeState('working', state.microphoneMuted);
    case 'input-required':
      return activeState('waiting-for-input', state.microphoneMuted);
    case 'synthesizing':
      return activeState('synthesizing', state.microphoneMuted);
    case 'speaking':
      return activeState('speaking', state.microphoneMuted);
    case 'speech-finished':
      return activeState(event.resume, state.microphoneMuted);
    case 'turn-settled':
      return activeState(state.microphoneMuted ? 'paused' : 'listening', state.microphoneMuted);
    case 'mute-microphone':
      return activeState(state.phase === 'listening' ? 'paused' : state.phase, true);
    case 'unmute-microphone':
      return activeState(state.phase === 'paused' ? 'listening' : state.phase, false);
    case 'failed':
      return {
        active: true,
        phase: 'error',
        errorReason: event.reason,
        microphoneMuted: state.microphoneMuted,
      };
    case 'retry':
      return state.phase === 'error' ? activeState('checking') : state;
    default:
      return state;
  }
}
