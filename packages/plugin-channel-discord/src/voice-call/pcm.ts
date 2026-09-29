import { OpusDecoder } from 'opus-decoder';

/** Discord voice is Opus at 48 kHz, two channels. */
const DISCORD_SAMPLE_RATE = 48_000;
const DISCORD_CHANNELS = 2;
/** What the transcribers take in-process (`MOXXY_PCM16_24KHZ_MIME`). */
const TARGET_SAMPLE_RATE = 24_000;

/**
 * Mix to mono, bring the rate down to 24 kHz (averaging each span of input
 * samples, which also filters what the lower rate cannot hold) and encode as
 * 16-bit little-endian PCM, clipping anything beyond full scale.
 */
export function toPcm16Mono24k(channels: ReadonlyArray<Float32Array>, sampleRate: number): Uint8Array {
  const length = Math.min(...channels.map((c) => c.length));
  if (channels.length === 0 || length === 0) return new Uint8Array(0);
  const ratio = sampleRate / TARGET_SAMPLE_RATE;
  const outLength = Math.floor(length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const from = Math.floor(i * ratio);
    const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let s = from; s < to; s += 1) {
      for (const channel of channels) sum += channel[s] ?? 0;
    }
    const sample = Math.max(-1, Math.min(1, sum / ((to - from) * channels.length)));
    out[i] = Math.round(sample < 0 ? sample * 32_768 : sample * 32_767);
  }
  return new Uint8Array(out.buffer);
}

/** Decode one utterance's Discord Opus packets into transcriber-ready PCM. */
export async function decodeUtterance(packets: ReadonlyArray<Uint8Array>): Promise<Uint8Array> {
  if (packets.length === 0) return new Uint8Array(0);
  const decoder = new OpusDecoder({ channels: DISCORD_CHANNELS, sampleRate: DISCORD_SAMPLE_RATE });
  await decoder.ready;
  try {
    const left: Float32Array[] = [];
    const right: Float32Array[] = [];
    for (const packet of packets) {
      const { channelData, samplesDecoded } = decoder.decodeFrame(packet);
      const [l, r] = channelData;
      if (!l || samplesDecoded === 0) continue;
      left.push(l.subarray(0, samplesDecoded));
      right.push((r ?? l).subarray(0, samplesDecoded));
    }
    return toPcm16Mono24k([concat(left), concat(right)], DISCORD_SAMPLE_RATE);
  } finally {
    decoder.free();
  }
}

function concat(parts: ReadonlyArray<Float32Array>): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
