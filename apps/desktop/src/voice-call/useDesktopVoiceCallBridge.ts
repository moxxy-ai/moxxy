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
}

const SNAPSHOT_REQUEST_RETRY_MS = 250;
const MAX_SNAPSHOT_REQUEST_ATTEMPTS = 8;

function isAudioSpectrumAnalyser(value: unknown): value is AudioSpectrumAnalyser {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<AudioSpectrumAnalyser>;
  return Number.isInteger(candidate.frequencyBinCount)
    && Number(candidate.frequencyBinCount) > 0
    && typeof candidate.getByteFrequencyData === 'function';
}

function snapshotFrom(call: UseVoiceCall): DesktopVoiceCallSnapshot {
  return {
    active: call.active,
    phase: call.phase,
    activity: call.activity,
    errorReason: call.errorReason?.slice(0, 500) ?? null,
    microphoneMuted: call.microphoneMuted,
    waitingSoundEnabled: call.waitingSoundEnabled,
  };
}

function runOwnerCommand(call: UseVoiceCall, command: DesktopVoiceCallCommand): void {
  switch (command) {
    case 'close':
      call.close();
      return;
    case 'retry':
      call.retry();
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
}: UseDesktopVoiceCallBridgeOptions): UseVoiceCall {
  const bridgePortRef = useRef<DesktopVoiceCallBridgePort | null>(null);
  const [remoteSnapshot, setRemoteSnapshot] = useState<DesktopVoiceCallSnapshot | null>(null);
  const [remoteAudioSource, setRemoteAudioSource] = useState<
    'microphone' | 'assistant' | null
  >(null);
  const microphoneSpectrum = useRef(new RemoteAudioSpectrum());
  const assistantSpectrum = useRef(new RemoteAudioSpectrum());
  const localCallRef = useRef(localCall);
  const publishSpectrumRef = useRef<(() => void) | null>(null);
  localCallRef.current = localCall;

  const publishSnapshot = useCallback((): void => {
    bridgePortRef.current?.post({
      type: 'snapshot',
      source: 'main',
      workspaceId,
      snapshot: snapshotFrom(localCallRef.current),
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
    localCall.phase,
    localCall.waitingSoundEnabled,
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

  const remoteActive = surface === 'focus' && remoteSnapshot?.active === true;
  return useMemo(() => {
    if (!remoteActive || !remoteSnapshot) return localCall;
    return {
      ...localCall,
      ...remoteSnapshot,
      lastTranscript: null,
      inputAnalyser: remoteAudioSource === 'microphone' ? microphoneSpectrum.current : null,
      outputAnalyser: remoteAudioSource === 'assistant' ? assistantSpectrum.current : null,
      close: () => sendCommand('close'),
      retry: () => sendCommand('retry'),
      muteMicrophone: () => sendCommand('mute-microphone'),
      unmuteMicrophone: () => sendCommand('unmute-microphone'),
      toggleWaitingSound: () => sendCommand('toggle-waiting-sound'),
      finishUtterance: () => undefined,
      restartListening: () => undefined,
      bargeIn: () => undefined,
    };
  }, [localCall, remoteActive, remoteAudioSource, remoteSnapshot, sendCommand]);
}
