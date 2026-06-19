/**
 * The Web platform capability bundle for the desktop renderer:
 *
 *   import { webPlatform } from '@moxxy/client-platform-web';
 *   configurePlatform(webPlatform);
 *
 * Plus the standalone TTS functions the read-aloud button imports directly.
 */

import type { PlatformCapabilities } from '@moxxy/client-core';
import { webAudioCapture } from './audio-capture.js';
import { webTts } from './tts.js';
import { webKeyValueStore } from './kv.js';
import { webEventBus } from './event-bus.js';

export { webAudioCapture } from './audio-capture.js';
export { webEventBus } from './event-bus.js';
export { webKeyValueStore } from './kv.js';
export {
  webTts,
  speak,
  cancelSpeech,
  isSpeechSupported,
  playAudioClip,
  pickVoice,
  type SpeakOptions,
  type AudioClipHandle,
} from './tts.js';
export { audioToPcm16, pcm16Peak, uint8ArrayToBase64, MOXXY_PCM16_24KHZ_MIME } from './pcm16.js';

/** Everything `@moxxy/client-core` can use on the web, ready for
 *  `configurePlatform`. */
export const webPlatform: PlatformCapabilities = {
  audioCapture: webAudioCapture,
  tts: webTts,
  ...(webEventBus ? { eventBus: webEventBus } : {}),
  ...(webKeyValueStore ? { kv: webKeyValueStore } : {}),
};
