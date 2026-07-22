import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VOICE_WAITING_TONE } from './voice-waiting-tone';

describe('VOICE_WAITING_TONE', () => {
  it('embeds the exact default CC0 processing loop as a pinned desktop asset', () => {
    const assetPath = resolve(process.cwd(), 'src/voice-call/assets/voice-waiting-loop.ogg');
    const licensePath = resolve(process.cwd(), 'src/voice-call/assets/voice-waiting-loop.LICENSE.md');
    const bytes = readFileSync(assetPath);
    const license = readFileSync(licensePath, 'utf8');

    expect(VOICE_WAITING_TONE.audioUrl).toContain('voice-waiting-loop.ogg');
    expect(bytes.toString('ascii', 0, 4)).toBe('OggS');
    expect(bytes.includes(Buffer.from('OpusHead'))).toBe(true);
    expect(bytes).toHaveLength(6_592);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '4830fa75386e9d432e78456f0616a529e0ff21b17ce278ad6096173db9be836c',
    );
    expect(license).toContain('UI SFX v0.4.0');
    expect(license).toContain('sounds/minimal/processing.ogg');
    expect(license).toContain('CC0-1.0');
  });
});
