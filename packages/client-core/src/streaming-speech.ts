// The speech segmenter lives in @moxxy/chat-model so the Discord bot's voice
// calls split replies exactly like the desktop's Voice Mode.
export {
  IncrementalSpeechSegmenter,
  detectSpeechLanguage,
  type IncrementalSpeechSegmenterOptions,
  type SpeechLanguage,
} from '@moxxy/chat-model';
