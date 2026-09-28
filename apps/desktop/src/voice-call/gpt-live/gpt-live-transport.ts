const DATA_CHANNEL_LABEL = 'oai-events';
const CHANNEL_OPEN_TIMEOUT_MS = 30_000;
const MAX_OUTBOUND_EVENT_CHARS = 256_000;
const ANALYSER_FFT_SIZE = 256;
const ANALYSER_SMOOTHING = 0.7;

interface AudioTrackLike {
  enabled: boolean;
  stop(): void;
}

interface MediaStreamLike {
  getTracks(): AudioTrackLike[];
}

interface DataChannelLike {
  readonly readyState: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: never) => void): void;
  removeEventListener(type: string, listener: (event: never) => void): void;
}

interface PeerConnectionLike {
  readonly connectionState: string;
  addTrack(track: AudioTrackLike, stream: MediaStreamLike): void;
  createDataChannel(label: string): DataChannelLike;
  createOffer(): Promise<{ readonly type: string; readonly sdp?: string }>;
  setLocalDescription(description: { readonly type: string; readonly sdp: string }): Promise<void>;
  setRemoteDescription(description: { readonly type: string; readonly sdp: string }): Promise<void>;
  close(): void;
  addEventListener(type: string, listener: (event: never) => void): void;
}

interface AudioAnalyserLike {
  fftSize: number;
  smoothingTimeConstant: number;
}

interface AudioContextLike {
  readonly state: string;
  resume(): Promise<void>;
  close(): Promise<void>;
  createAnalyser(): AudioAnalyserLike;
  createMediaStreamSource(stream: MediaStreamLike): { connect(target: AudioAnalyserLike): void };
}

interface AudioElementLike {
  autoplay: boolean;
  muted: boolean;
  srcObject: unknown;
  play(): Promise<void>;
  pause(): void;
  removeAttribute(name: string): void;
}

export interface GptLiveConnection {
  readonly callId: string;
  send(payload: unknown): void;
  setMuted(muted: boolean): void;
  close(): void;
}

export interface GptLiveConnectOptions {
  /** Exchanges the offer for the call answer; OAuth stays behind desktop IPC. */
  readonly negotiate: (offerSdp: string) => Promise<{ readonly sdp: string; readonly callId: string }>;
  readonly onEvent: (raw: string) => void;
  readonly onInputAnalyser?: (analyser: unknown | null) => void;
  readonly onOutputAnalyser?: (analyser: unknown | null) => void;
  readonly onConnectionError?: (message: string) => void;
}

export interface GptLiveTransport {
  connect(options: GptLiveConnectOptions): Promise<GptLiveConnection>;
}

interface BrowserGptLiveDependencies {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStreamLike>;
  readonly createPeerConnection: () => PeerConnectionLike;
  readonly createAudioContext: () => AudioContextLike | null;
  readonly createAudioElement: () => AudioElementLike;
}

function browserDependencies(): BrowserGptLiveDependencies {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createPeerConnection: () => new RTCPeerConnection(),
    createAudioContext: () => (typeof AudioContext === 'function' ? new AudioContext() : null),
    createAudioElement: () => document.createElement('audio'),
  } as BrowserGptLiveDependencies;
}

/** Browser-owned WebRTC audio + event channel for one GPT-Live call. */
export class BrowserGptLiveTransport implements GptLiveTransport {
  private readonly dependencies: BrowserGptLiveDependencies;

  constructor(dependencies: BrowserGptLiveDependencies = browserDependencies()) {
    this.dependencies = dependencies;
  }

  async connect(options: GptLiveConnectOptions): Promise<GptLiveConnection> {
    const stream = await this.dependencies.getUserMedia({
      audio: {
        echoCancellation: { ideal: true },
        noiseSuppression: { ideal: true },
        autoGainControl: { ideal: true },
      },
    });
    const peer = this.dependencies.createPeerConnection();
    const channel = peer.createDataChannel(DATA_CHANNEL_LABEL);
    const audioContext = this.dependencies.createAudioContext();
    const audio = this.dependencies.createAudioElement();
    let closed = false;
    let remoteAttached = false;

    const close = (): void => {
      if (closed) return;
      closed = true;
      options.onInputAnalyser?.(null);
      options.onOutputAnalyser?.(null);
      for (const track of stream.getTracks()) track.stop();
      try { channel.close(); } catch { /* already closed */ }
      try { peer.close(); } catch { /* already closed */ }
      audio.pause();
      audio.srcObject = null;
      audio.removeAttribute('src');
      if (audioContext) void audioContext.close().catch(() => undefined);
    };

    const analyse = (source: MediaStreamLike): AudioAnalyserLike | null => {
      if (!audioContext) return null;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = ANALYSER_SMOOTHING;
      audioContext.createMediaStreamSource(source).connect(analyser);
      return analyser;
    };

    channel.addEventListener('message', (rawEvent: never) => {
      const event = rawEvent as unknown as { data?: unknown };
      if (typeof event.data === 'string') options.onEvent(event.data);
    });
    peer.addEventListener('connectionstatechange', () => {
      if (peer.connectionState !== 'failed') return;
      options.onConnectionError?.('The GPT-Live connection dropped.');
      close();
    });
    peer.addEventListener('track', (rawEvent: never) => {
      if (remoteAttached || closed) return;
      const remoteStream = (rawEvent as unknown as { streams?: MediaStreamLike[] }).streams?.[0];
      if (!remoteStream) return;
      remoteAttached = true;
      audio.autoplay = true;
      audio.muted = false;
      audio.srcObject = remoteStream;
      void audio.play().catch(() => {
        options.onConnectionError?.('GPT-Live audio playback was blocked.');
      });
      options.onOutputAnalyser?.(analyse(remoteStream));
    });

    try {
      if (audioContext && audioContext.state !== 'running') await audioContext.resume();
      options.onInputAnalyser?.(analyse(stream));
      for (const track of stream.getTracks()) peer.addTrack(track, stream);
      const channelOpen = waitForChannelOpen(channel);
      void channelOpen.catch(() => undefined);
      const offer = await peer.createOffer();
      if (offer.type !== 'offer' || !offer.sdp?.startsWith('v=0')) {
        throw new Error('GPT-Live could not create a valid WebRTC offer.');
      }
      await peer.setLocalDescription({ type: 'offer', sdp: offer.sdp });
      const answer = await options.negotiate(offer.sdp);
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
      await channelOpen;

      return {
        callId: answer.callId,
        send: (payload): void => {
          if (closed || channel.readyState !== 'open') return;
          const serialized = JSON.stringify(payload);
          if (serialized.length > MAX_OUTBOUND_EVENT_CHARS) {
            throw new Error('GPT-Live event exceeds the allowed size.');
          }
          channel.send(serialized);
        },
        setMuted: (muted): void => {
          if (closed) return;
          for (const track of stream.getTracks()) track.enabled = !muted;
        },
        close,
      };
    } catch (error) {
      close();
      throw error;
    }
  }
}

function waitForChannelOpen(channel: DataChannelLike): Promise<void> {
  if (channel.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('GPT-Live data channel timed out.')), CHANNEL_OPEN_TIMEOUT_MS);
    const onOpen = (): void => finish();
    const onError = (): void => finish(new Error('GPT-Live data channel failed.'));
    const onClose = (): void => finish(new Error('GPT-Live data channel closed before opening.'));
    const finish = (error?: Error): void => {
      clearTimeout(timeout);
      channel.removeEventListener('open', onOpen as (event: never) => void);
      channel.removeEventListener('error', onError as (event: never) => void);
      channel.removeEventListener('close', onClose as (event: never) => void);
      if (error) reject(error);
      else resolve();
    };
    channel.addEventListener('open', onOpen as (event: never) => void);
    channel.addEventListener('error', onError as (event: never) => void);
    channel.addEventListener('close', onClose as (event: never) => void);
  });
}
