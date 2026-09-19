import { z } from 'zod';
import type { VoiceCallPhase, VoiceToolActivity } from '@moxxy/client-core';

export const DESKTOP_VOICE_CALL_CHANNEL = 'moxxy.desktop.voice-call.v1';

export type DesktopVoiceCallSurface = 'main' | 'focus';

export interface DesktopVoiceQueuedTurn {
  readonly id: string;
  readonly prompt: string;
}

export interface DesktopVoiceCallSnapshot {
  readonly active: boolean;
  readonly phase: VoiceCallPhase;
  readonly activity: VoiceToolActivity | null;
  readonly errorReason: string | null;
  readonly microphoneMuted: boolean;
  readonly waitingSoundEnabled: boolean;
  readonly localPiperInstallRequired: boolean;
  readonly localPiperInstalling: boolean;
  readonly localPiperInstallError: string | null;
  readonly queuedTurns: ReadonlyArray<DesktopVoiceQueuedTurn>;
}

export type DesktopVoiceCallCommand =
  | 'open'
  | 'close'
  | 'retry'
  | 'install-local-piper'
  | 'mute-microphone'
  | 'unmute-microphone'
  | 'toggle-waiting-sound';

export type DesktopVoiceCallBridgeMessage =
  | {
      readonly type: 'snapshot-request';
      readonly source: 'focus';
      readonly workspaceId: string;
    }
  | {
      readonly type: 'command';
      readonly source: 'focus';
      readonly workspaceId: string;
      readonly command: DesktopVoiceCallCommand;
    }
  | {
      readonly type: 'snapshot';
      readonly source: 'main';
      readonly workspaceId: string;
      readonly snapshot: DesktopVoiceCallSnapshot;
    }
  | {
      readonly type: 'queue-drop';
      readonly source: 'focus';
      readonly workspaceId: string;
      readonly queueId: string;
    }
  | {
      readonly type: 'spectrum';
      readonly source: 'main';
      readonly workspaceId: string;
      readonly audioSource: 'microphone' | 'assistant';
      readonly bins: Uint8Array;
    }
  | {
      readonly type: 'spectrum-clear';
      readonly source: 'main';
      readonly workspaceId: string;
    };

export interface DesktopVoiceCallBridgePort {
  post(message: DesktopVoiceCallBridgeMessage): void;
  subscribe(listener: (message: unknown) => void): () => void;
  close(): void;
}

const workspaceIdSchema = z.string().min(1).max(256);
const phaseSchema = z.enum([
  'idle',
  'checking',
  'arming',
  'listening',
  'transcribing',
  'thinking',
  'working',
  'waiting-for-input',
  'synthesizing',
  'speaking',
  'paused',
  'error',
]);
const activitySchema = z.enum([
  'research',
  'editing',
  'command',
  'verification',
  'application',
  'generic',
]);
const queuedTurnSchema = z.object({
  id: z.string().min(1).max(128),
  prompt: z.string().max(4_096),
}).strict();
const snapshotSchema = z.object({
  active: z.boolean(),
  phase: phaseSchema,
  activity: activitySchema.nullable(),
  errorReason: z.string().max(500).nullable(),
  microphoneMuted: z.boolean(),
  waitingSoundEnabled: z.boolean(),
  localPiperInstallRequired: z.boolean(),
  localPiperInstalling: z.boolean(),
  localPiperInstallError: z.string().max(500).nullable(),
  queuedTurns: z.array(queuedTurnSchema).max(32).default([]),
}).strict();
function isUint8ArrayView(value: unknown): value is Uint8Array {
  return ArrayBuffer.isView(value)
    && Object.prototype.toString.call(value) === '[object Uint8Array]';
}
const spectrumSchema = z.custom<Uint8Array>(
  (value) => isUint8ArrayView(value) && value.length > 0 && value.length <= 4_096,
);
const messageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('snapshot-request'),
    source: z.literal('focus'),
    workspaceId: workspaceIdSchema,
  }).strict(),
  z.object({
    type: z.literal('command'),
    source: z.literal('focus'),
    workspaceId: workspaceIdSchema,
    command: z.enum([
      'open',
      'close',
      'retry',
      'install-local-piper',
      'mute-microphone',
      'unmute-microphone',
      'toggle-waiting-sound',
    ]),
  }).strict(),
  z.object({
    type: z.literal('snapshot'),
    source: z.literal('main'),
    workspaceId: workspaceIdSchema,
    snapshot: snapshotSchema,
  }).strict(),
  z.object({
    type: z.literal('queue-drop'),
    source: z.literal('focus'),
    workspaceId: workspaceIdSchema,
    queueId: z.string().min(1).max(128),
  }).strict(),
  z.object({
    type: z.literal('spectrum'),
    source: z.literal('main'),
    workspaceId: workspaceIdSchema,
    audioSource: z.enum(['microphone', 'assistant']),
    bins: spectrumSchema,
  }).strict(),
  z.object({
    type: z.literal('spectrum-clear'),
    source: z.literal('main'),
    workspaceId: workspaceIdSchema,
  }).strict(),
]);

export function parseDesktopVoiceCallMessage(
  value: unknown,
): DesktopVoiceCallBridgeMessage | null {
  const parsed = messageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Read-only analyser facade updated by bounded cross-window spectrum frames. */
export class RemoteAudioSpectrum {
  private bins = new Uint8Array([0]);

  get frequencyBinCount(): number {
    return this.bins.length;
  }

  update(next: Uint8Array): void {
    this.bins = new Uint8Array(next);
  }

  getByteFrequencyData(target: Uint8Array): void {
    target.fill(0);
    target.set(this.bins.subarray(0, target.length));
  }
}

export function createDesktopVoiceCallBridgePort(): DesktopVoiceCallBridgePort | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(DESKTOP_VOICE_CALL_CHANNEL);
  } catch {
    return null;
  }
  return {
    post: (message) => {
      try {
        channel.postMessage(message);
      } catch {
        // Focus Mode remains locally usable when the cross-window channel closes.
      }
    },
    subscribe: (listener) => {
      const onMessage = (event: MessageEvent<unknown>): void => listener(event.data);
      channel.addEventListener('message', onMessage);
      return () => channel.removeEventListener('message', onMessage);
    },
    close: () => {
      try {
        channel.close();
      } catch {
        // Idempotent teardown for renderer shutdown races.
      }
    },
  };
}
