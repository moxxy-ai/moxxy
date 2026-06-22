import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Platform } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';

export type VoicePhase = 'idle' | 'recording' | 'transcribing' | 'error';

export interface RecordedAudioClip {
  readonly audioBase64: string;
  readonly mimeType: string;
}

interface UseVoiceRecorderOptions {
  readonly disabled?: boolean;
  readonly onClip: (clip: RecordedAudioClip) => void;
}

interface WebRecorderState {
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
}

const WEB_MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
const NATIVE_MIME_TYPE = 'audio/m4a';
const ERROR_RESET_MS = 2500;

export function useVoiceRecorder(options: UseVoiceRecorderOptions) {
  const nativeRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const nativeState = useAudioRecorderState(nativeRecorder);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const phaseRef = useRef<VoicePhase>('idle');
  const webRecorderRef = useRef<WebRecorderState | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onClipRef = useRef(options.onClip);
  onClipRef.current = options.onClip;

  const setVoicePhase = useCallback((next: VoicePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const fail = useCallback((reason: string) => {
    setErrorReason(reason);
    setVoicePhase('error');
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => {
      setErrorReason(null);
      setVoicePhase('idle');
    }, ERROR_RESET_MS);
  }, [setVoicePhase]);

  const start = useCallback(async () => {
    if (options.disabled || phaseRef.current !== 'idle') return;
    try {
      if (Platform.OS === 'web') {
        await startWebRecording(webRecorderRef);
      } else {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          fail('Microphone permission denied.');
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        await nativeRecorder.prepareToRecordAsync();
        nativeRecorder.record();
      }
      setVoicePhase('recording');
      setErrorReason(null);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Microphone is not available.');
    }
  }, [fail, nativeRecorder, options.disabled, setVoicePhase]);

  const stop = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    setVoicePhase('transcribing');
    try {
      const clip = Platform.OS === 'web'
        ? await stopWebRecording(webRecorderRef)
        : await stopNativeRecording(nativeRecorder);
      if (clip.audioBase64.length === 0) {
        fail('No speech detected - try again.');
        return;
      }
      onClipRef.current(clip);
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Voice transcription failed.');
    } finally {
      if (Platform.OS !== 'web') {
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      }
    }
  }, [fail, nativeRecorder, setVoicePhase]);

  const toggle = useCallback(() => {
    if (phaseRef.current === 'recording' || nativeState.isRecording) {
      void stop();
      return;
    }
    if (phaseRef.current === 'idle') void start();
  }, [nativeState.isRecording, start, stop]);

  const complete = useCallback(() => {
    if (phaseRef.current === 'transcribing') setVoicePhase('idle');
  }, [setVoicePhase]);

  useEffect(() => {
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
      const web = webRecorderRef.current;
      web?.stream.getTracks().forEach((track) => track.stop());
      webRecorderRef.current = null;
    };
  }, []);

  return {
    phase,
    errorReason,
    toggle,
    start,
    stop,
    complete,
  };
}

async function startWebRecording(ref: MutableRefObject<WebRecorderState | null>) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder is not available in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickWebMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });
  recorder.start();
  ref.current = { recorder, stream, chunks };
}

async function stopWebRecording(ref: MutableRefObject<WebRecorderState | null>): Promise<RecordedAudioClip> {
  const active = ref.current;
  if (!active) throw new Error('Voice recorder is not running.');
  ref.current = null;
  const blob = await new Promise<Blob>((resolve) => {
    active.recorder.addEventListener('stop', () => {
      active.stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(active.chunks, { type: active.recorder.mimeType || 'audio/webm' }));
    }, { once: true });
    active.recorder.stop();
  });
  return {
    audioBase64: await blobToBase64(blob),
    mimeType: blob.type || 'audio/webm',
  };
}

async function stopNativeRecording(nativeRecorder: ReturnType<typeof useAudioRecorder>): Promise<RecordedAudioClip> {
  await nativeRecorder.stop();
  const uri = nativeRecorder.uri;
  if (!uri) throw new Error('Voice recorder did not produce an audio file.');
  return {
    audioBase64: await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 }),
    mimeType: NATIVE_MIME_TYPE,
  };
}

function pickWebMimeType(): string | undefined {
  return WEB_MIME_CANDIDATES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read recorded audio.'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
}
