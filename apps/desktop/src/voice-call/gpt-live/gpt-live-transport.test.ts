import { describe, expect, it, vi } from 'vitest';
import { BrowserGptLiveTransport } from './gpt-live-transport';

// jsdom has no WebRTC or media devices, so the browser boundary is stood in by
// objects with the same surface. The real peer connection is exercised by the
// desktop smoke against the live service (docs/voice-gpt-live.md).
function createHarness() {
  const track = { enabled: true, stop: vi.fn() };
  const stream = { getTracks: () => [track] };
  const channel = {
    readyState: 'connecting',
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const peer = {
    connectionState: 'new',
    addTrack: vi.fn(),
    createDataChannel: vi.fn(() => channel),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'v=0\r\no=offer\r\n' })),
    setLocalDescription: vi.fn(async () => undefined),
    setRemoteDescription: vi.fn(async () => undefined),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const analyser = { fftSize: 0, smoothingTimeConstant: 0 };
  const audioContext = {
    state: 'running',
    resume: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createAnalyser: vi.fn(() => analyser),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  };
  const audio = {
    autoplay: false,
    muted: true,
    srcObject: null as unknown,
    pause: vi.fn(),
    play: vi.fn(async () => undefined),
    removeAttribute: vi.fn(),
  };
  const media = { getUserMedia: vi.fn(async () => stream) };
  const transport = new BrowserGptLiveTransport({
    getUserMedia: media.getUserMedia as never,
    createPeerConnection: () => peer as never,
    createAudioContext: () => audioContext as never,
    createAudioElement: () => audio as never,
  });
  return { track, channel, peer, audioContext, audio, media, transport };
}

function listener<T>(target: { addEventListener: ReturnType<typeof vi.fn> }, type: string): T {
  const found = target.addEventListener.mock.calls.find(([name]) => name === type)?.[1];
  if (!found) throw new Error(`no ${type} listener`);
  return found as T;
}

describe('BrowserGptLiveTransport', () => {
  it('negotiates the call, plays GPT-Live audio, and owns the whole media lifecycle', async () => {
    const h = createHarness();
    const negotiate = vi.fn(async () => ({ sdp: 'v=0\r\no=answer\r\n', callId: 'rtc_1' }));
    const onEvent = vi.fn();

    const connecting = h.transport.connect({ negotiate, onEvent });
    await vi.waitFor(() => expect(h.channel.addEventListener).toHaveBeenCalledWith('open', expect.any(Function)));
    h.channel.readyState = 'open';
    listener<() => void>(h.channel, 'open')();
    const connection = await connecting;

    expect(h.peer.createDataChannel).toHaveBeenCalledWith('oai-events');
    expect(negotiate).toHaveBeenCalledWith('v=0\r\no=offer\r\n');
    expect(h.peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'v=0\r\no=answer\r\n' });

    const remoteStream = { getTracks: () => [] };
    listener<(event: { streams: unknown[] }) => void>(h.peer, 'track')({ streams: [remoteStream] });
    expect(h.audio.srcObject).toBe(remoteStream);
    expect(h.audio.muted).toBe(false);
    expect(h.audio.play).toHaveBeenCalledOnce();

    listener<(event: { data: string }) => void>(h.channel, 'message')({ data: '{"type":"session.started"}' });
    expect(onEvent).toHaveBeenCalledWith('{"type":"session.started"}');

    connection.send({ type: 'session.close' });
    expect(h.channel.send).toHaveBeenCalledWith('{"type":"session.close"}');
    connection.setMuted(true);
    expect(h.track.enabled).toBe(false);

    connection.close();
    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.channel.close).toHaveBeenCalledOnce();
    expect(h.peer.close).toHaveBeenCalledOnce();
    expect(h.audio.pause).toHaveBeenCalledOnce();
    expect(h.audioContext.close).toHaveBeenCalledOnce();
  });

  it('releases the microphone when negotiation fails', async () => {
    const h = createHarness();

    await expect(h.transport.connect({
      negotiate: async () => { throw new Error('Voice session access denied'); },
      onEvent: vi.fn(),
    })).rejects.toThrow('Voice session access denied');

    expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.peer.close).toHaveBeenCalledOnce();
    expect(h.audioContext.close).toHaveBeenCalledOnce();
  });

  it('reports a dropped connection', async () => {
    const h = createHarness();
    const onConnectionError = vi.fn();
    const connecting = h.transport.connect({
      negotiate: async () => ({ sdp: 'v=0\r\no=answer\r\n', callId: 'rtc_1' }),
      onEvent: vi.fn(),
      onConnectionError,
    });
    await vi.waitFor(() => expect(h.channel.addEventListener).toHaveBeenCalledWith('open', expect.any(Function)));
    h.channel.readyState = 'open';
    listener<() => void>(h.channel, 'open')();
    await connecting;

    h.peer.connectionState = 'failed';
    listener<() => void>(h.peer, 'connectionstatechange')();

    expect(onConnectionError).toHaveBeenCalledWith(expect.stringMatching(/connection/i));
    expect(h.track.stop).toHaveBeenCalledOnce();
  });
});
