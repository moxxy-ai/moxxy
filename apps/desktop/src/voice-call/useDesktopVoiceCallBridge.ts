import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UseVoiceCall } from '@moxxy/client-core';
import {
  createDesktopVoiceCallBridgePort,
  parseDesktopVoiceCallMessage,
  RemoteAudioSpectrum,
  type DesktopVoiceCallBridgePort,
  type DesktopVoiceCallCommand,
  type DesktopVoiceCallSnapshot,
  type DesktopVoiceCallSurface,
  type DesktopVoiceQueuedTurn,
} from './desktop-voice-call-bridge';

interface AudioSpectrumAnalyser {
  readonly frequencyBinCount: number;
  getByteFrequencyData(target: Uint8Array): void;
}

interface UseDesktopVoiceCallBridgeOptions {
  readonly surface: DesktopVoiceCallSurface;
  readonly workspaceId: string;
  readonly localCall: UseVoiceCall;
  readonly port?: DesktopVoiceCallBridgePort | null;
  readonly queuedTurns?: ReadonlyArray<DesktopVoiceQueuedTurn>;
  readonly dropQueuedTurn?: (id: string) => void;
}

export interface DesktopVoiceCallBridgeResult extends UseVoiceCall {
  readonly remoteQueuedTurns: ReadonlyArray<DesktopVoiceQueuedTurn>;
  readonly dropRemoteQueuedTurn: (id: string) => void;
}

const SNAPSHOT_REQUEST_RETRY_MS = 250;
const MAX_SNAPSHOT_REQUEST_ATTEMPTS = 8;
const EMPTY_QUEUED_TURNS: ReadonlyArray<DesktopVoiceQueuedTurn> = Object.freeze([]);

function isAudioSpectrumAnalyser(value: unknown): value is AudioSpectrumAnalyser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AudioSpectrumAnalyser>;
  return Number.isInteger(candidate.frequencyBinCount)
    && Number(candidate.frequencyBinCount) > 0
    && typeof candidate.getByteFrequencyData === 'function';
}

function snapshotFrom(
  call: UseVoiceCall,
  queuedTurns: ReadonlyArray<DesktopVoiceQueuedTurn>,
): DesktopVoiceCallSnapshot {
  return {
    active: call.active,
    phase: call.phase,
    activity: call.activity,
    errorReason: call.errorReason?.slice(0, 500) ?? null,
    microphoneMuted: call.microphoneMuted,
    waitingSoundEnabled: call.waitingSoundEnabled,
    localPiperInstallRequired: call.localPiperInstallRequired,
    localPiperInstalling: call.localPiperInstalling,
    localPiperInstallError: call.localPiperInstallError?.slice(0, 500) ?? null,
    queuedTurns: queuedTurns.slice(0, 32).map((turn) => ({
      id: turn.id.slice(0, 128),
      prompt: turn.prompt.slice(0, 4_096),
    })),
  };
}

function runOwnerCommand(call: UseVoiceCall, command: DesktopVoiceCallCommand): void {
  switch (command) {
    case 'open':
      call.open();
      return;
    case 'close':
      call.close();
      return;
    case 'retry':
      call.retry();
      return;
    case 'install-local-piper':
      call.installLocalPiper();
      return;
    case 'mute-microphone':
      call.muteMicrophone();
      return;
    case 'unmute-microphone':
      call.unmuteMicrophone();
      return;
    case 'toggle-waiting-sound':
      call.toggleWaitingSound();
  }
}

/**
 * Mirrors a main-window Voice Mode into Focus Mode without transferring audio
 * ownership. The main renderer keeps the recorder, transcriber and Piper queue.
 */
export function useDesktopVoiceCallBridge({
  surface,
  workspaceId,
  localCall,
  port,
  queuedTurns = EMPTY_QUEUED_TURNS,
  dropQueuedTurn,
}: UseDesktopVoiceCallBridgeOptions): DesktopVoiceCallBridgeResult {
  const bridgePortRef = useRef<DesktopVoiceCallBridgePort | null>(null);
  const [remoteSnapshot, setRemoteSnapshot] = useState<DesktopVoiceCallSnapshot | null>(null);
  const [remoteAudioSource, setRemoteAudioSource] = useState<
    'microphone' | 'assistant' | null
  >(null);
  const microphoneSpectrum = useRef(new RemoteAudioSpectrum());
  const assistantSpectrum = useRef(new RemoteAudioSpectrum());
  const localCallRef = useRef(localCall);
  const queuedTurnsRef = useRef(queuedTurns);
  const dropQueuedTurnRef = useRef(dropQueuedTurn);
  const publishSpectrumRef = useRef<(() => void) | null>(null);
  localCallRef.current = localCall;
  queuedTurnsRef.current = queuedTurns;
  dropQueuedTurnRef.current = dropQueuedTurn;

  const publishSnapshot = useCallback((): void => {
    bridgePortRef.current?.post({
      type: 'snapshot',
      source: 'main',
      workspaceId,
      snapshot: snapshotFrom(localCallRef.current, queuedTurnsRef.current),
    });
  }, [workspaceId]);

  useEffect(() => {
    const activePort = port === undefined ? createDesktopVoiceCallBridgePort() : port;
    bridgePortRef.current = activePort;
    if (!activePort) return;
    let snapshotReceived = false;
    let snapshotRequestAttempts = 0;
    let snapshotRequestTimer: number | null = null;
    const stopSnapshotRequests = (): void => {
      if (snapshotRequestTimer !== null) window.clearTimeout(snapshotRequestTimer);
      snapshotRequestTimer = null;
    };
    const requestSnapshot = (): void => {
      if (
        snapshotReceived
        || snapshotRequestAttempts >= MAX_SNAPSHOT_REQUEST_ATTEMPTS
        || workspaceId.length === 0
      ) return;
      snapshotRequestAttempts += 1;
      activePort.post({ type: 'snapshot-request', source: 'focus', workspaceId });
      if (!snapshotReceived && snapshotRequestAttempts < MAX_SNAPSHOT_REQUEST_ATTEMPTS) {
        snapshotRequestTimer = window.setTimeout(
          requestSnapshot,
          SNAPSHOT_REQUEST_RETRY_MS,
        );
      }
    };
    const unsubscribe = activePort.subscribe((value) => {
      const message = parseDesktopVoiceCallMessage(value);
      if (!message || message.workspaceId !== workspaceId) return;

      if (surface === 'main') {
        if (message.source !== 'focus') return;
        if (message.type === 'snapshot-request') {
          publishSnapshot();
          publishSpectrumRef.current?.();
        } else if (message.type === 'command') {
          runOwnerCommand(localCallRef.current, message.command);
        } else if (message.type === 'queue-drop') {
          dropQueuedTurnRef.current?.(message.queueId);
        }
        return;
      }

      if (message.source !== 'main') return;
      if (message.type === 'snapshot') {
        snapshotReceived = true;
        stopSnapshotRequests();
        setRemoteSnapshot(message.snapshot);
        if (!message.snapshot.active) setRemoteAudioSource(null);
      } else if (message.type === 'spectrum') {
        const spectrum = message.audioSource === 'microphone'
          ? microphoneSpectrum.current
          : assistantSpectrum.current;
        spectrum.update(message.bins);
        setRemoteAudioSource(message.audioSource);
      } else if (message.type === 'spectrum-clear') {
        setRemoteAudioSource(null);
      }
    });

    if (surface === 'focus') {
      setRemoteSnapshot(null);
      setRemoteAudioSource(null);
      requestSnapshot();
    } else {
      publishSnapshot();
    }

    return () => {
      stopSnapshotRequests();
      unsubscribe();
      if (bridgePortRef.current === activePort) bridgePortRef.current = null;
      if (port === undefined) activePort.close();
    };
  }, [port, publishSnapshot, surface, workspaceId]);

  useEffect(() => {
    if (surface !== 'main') return;
    publishSnapshot();
  }, [
    localCall.active,
    localCall.activity,
    localCall.errorReason,
    localCall.microphoneMuted,
    localCall.localPiperInstallRequired,
    localCall.localPiperInstalling,
    localCall.localPiperInstallError,
    localCall.phase,
    localCall.waitingSoundEnabled,
    queuedTurns,
    publishSnapshot,
    surface,
  ]);

  useEffect(() => {
    const activePort = bridgePortRef.current;
    if (surface !== 'main' || !activePort || !localCall.active) return;
    const output = isAudioSpectrumAnalyser(localCall.outputAnalyser)
      ? localCall.outputAnalyser
      : null;
    const input = isAudioSpectrumAnalyser(localCall.inputAnalyser)
      ? localCall.inputAnalyser
      : null;
    const analyser = output ?? input;
    const audioSource = output ? 'assistant' : input ? 'microphone' : null;
    if (!analyser || !audioSource) {
      publishSpectrumRef.current = () => {
        activePort.post({ type: 'spectrum-clear', source: 'main', workspaceId });
      };
      activePort.post({ type: 'spectrum-clear', source: 'main', workspaceId });
      return () => {
        publishSpectrumRef.current = null;
      };
    }

    const binCount = Math.min(analyser.frequencyBinCount, 4_096);
    const publishSpectrum = (): void => {
      const bins = new Uint8Array(binCount);
      analyser.getByteFrequencyData(bins);
      activePort.post({
        type: 'spectrum',
        source: 'main',
        workspaceId,
        audioSource,
        bins,
      });
    };
    publishSpectrumRef.current = publishSpectrum;
    publishSpectrum();
    const interval = window.setInterval(publishSpectrum, 50);
    return () => {
      window.clearInterval(interval);
      publishSpectrumRef.current = null;
      activePort.post({ type: 'spectrum-clear', source: 'main', workspaceId });
    };
  }, [
    localCall.active,
    localCall.inputAnalyser,
    localCall.outputAnalyser,
    surface,
    workspaceId,
  ]);

  useEffect(() => {
    if (surface !== 'focus' || !remoteSnapshot?.active || !localCall.active) return;
    localCall.close();
  }, [localCall, remoteSnapshot?.active, surface]);

  const sendCommand = useCallback((command: DesktopVoiceCallCommand): void => {
    bridgePortRef.current?.post({ type: 'command', source: 'focus', workspaceId, command });
  }, [workspaceId]);
  const dropRemoteQueuedTurn = useCallback((id: string): void => {
    setRemoteSnapshot((snapshot) => {
      if (!snapshot) return snapshot;
      return {
        ...snapshot,
        queuedTurns: snapshot.queuedTurns.filter((turn) => turn.id !== id),
      };
    });
    bridgePortRef.current?.post({
      type: 'queue-drop',
      source: 'focus',
      workspaceId,
      queueId: id,
    });
  }, [workspaceId]);

  const remoteActive = surface === 'focus' && remoteSnapshot?.active === true;
  return useMemo<DesktopVoiceCallBridgeResult>(() => {
    if (surface !== 'focus' || !remoteSnapshot) {
      return {
        ...localCall,
        remoteQueuedTurns: EMPTY_QUEUED_TURNS,
        dropRemoteQueuedTurn: () => undefined,
      };
    }
    if (!remoteActive) {
      return {
        ...localCall,
        ...remoteSnapshot,
        open: () => sendCommand('open'),
        remoteQueuedTurns: remoteSnapshot.queuedTurns,
        dropRemoteQueuedTurn,
      };
    }
    return {
      ...localCall,
      ...remoteSnapshot,
      remoteQueuedTurns: remoteSnapshot.queuedTurns,
      dropRemoteQueuedTurn,
      lastTranscript: null,
      inputAnalyser: remoteAudioSource === 'microphone' ? microphoneSpectrum.current : null,
      outputAnalyser: remoteAudioSource === 'assistant' ? assistantSpectrum.current : null,
      close: () => sendCommand('close'),
      retry: () => sendCommand('retry'),
      installLocalPiper: () => sendCommand('install-local-piper'),
      muteMicrophone: () => sendCommand('mute-microphone'),
      unmuteMicrophone: () => sendCommand('unmute-microphone'),
      toggleWaitingSound: () => sendCommand('toggle-waiting-sound'),
      finishUtterance: () => undefined,
      restartListening: () => undefined,
      bargeIn: () => undefined,
    };
  }, [
    dropRemoteQueuedTurn,
    localCall,
    remoteActive,
    remoteAudioSource,
    remoteSnapshot,
    sendCommand,
    surface,
  ]);
}
