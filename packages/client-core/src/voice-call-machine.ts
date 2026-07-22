export type VoiceCallPhase =
  | 'idle'
  | 'checking'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'waiting-for-input'
  | 'synthesizing'
  | 'speaking'
  | 'paused'
  | 'error';

export interface VoiceCallState {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly errorReason: string | null;
}

export type VoiceCallEvent =
  | { readonly type: 'open' }
  | { readonly type: 'ready' }
  | { readonly type: 'transcribing' }
  | { readonly type: 'transcript-ready' }
  | { readonly type: 'turn-started' }
  | { readonly type: 'input-required' }
  | { readonly type: 'input-resolved' }
  | { readonly type: 'synthesizing' }
  | { readonly type: 'speaking' }
  | { readonly type: 'turn-settled' }
  | { readonly type: 'pause' }
  | { readonly type: 'resume' }
  | { readonly type: 'failed'; readonly reason: string }
  | { readonly type: 'retry' }
  | { readonly type: 'close' };

const IDLE_STATE: VoiceCallState = Object.freeze({
  active: false,
  phase: 'idle',
  errorReason: null,
});

export function createVoiceCallState(): VoiceCallState {
  return IDLE_STATE;
}

function activeState(phase: VoiceCallPhase): VoiceCallState {
  return { active: true, phase, errorReason: null };
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
      return activeState('listening');
    case 'transcribing':
      return activeState('transcribing');
    case 'transcript-ready':
    case 'turn-started':
    case 'input-resolved':
      return activeState('thinking');
    case 'input-required':
      return activeState('waiting-for-input');
    case 'synthesizing':
      return activeState('synthesizing');
    case 'speaking':
      return activeState('speaking');
    case 'turn-settled':
      return activeState('listening');
    case 'pause':
      return state.phase === 'listening' ? activeState('paused') : state;
    case 'resume':
      return state.phase === 'paused' ? activeState('listening') : state;
    case 'failed':
      return { active: true, phase: 'error', errorReason: event.reason };
    case 'retry':
      return state.phase === 'error' ? activeState('checking') : state;
    default:
      return state;
  }
}
