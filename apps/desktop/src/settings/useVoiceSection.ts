import { useState } from 'react';

export type VoiceSectionId = 'conversation' | 'read-aloud' | 'transcription';

export const VOICE_SECTIONS: ReadonlyArray<{ readonly id: VoiceSectionId; readonly label: string }> = [
  { id: 'conversation', label: 'Conversation' },
  { id: 'read-aloud', label: 'Read aloud' },
  { id: 'transcription', label: 'Transcription' },
];

/** Which part of Settings → Voice is open; Conversation first. */
export function useVoiceSection(): {
  readonly section: VoiceSectionId;
  readonly setSection: (section: VoiceSectionId) => void;
} {
  const [section, setSection] = useState<VoiceSectionId>('conversation');
  return { section, setSection };
}
