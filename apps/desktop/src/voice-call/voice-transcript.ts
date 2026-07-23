import type { MoxxyEvent } from '@moxxy/sdk';

export interface VoiceTranscriptLine {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly streaming: boolean;
}

export function deriveVoiceTranscriptLines(
  events: ReadonlyArray<MoxxyEvent>,
  streamingText: string,
  provisionalTranscript: string | null,
  limit = 4,
): ReadonlyArray<VoiceTranscriptLine> {
  const lines: VoiceTranscriptLine[] = [];
  for (const event of events) {
    if (event.type === 'user_prompt') {
      lines.push({ role: 'user', text: event.text, streaming: false });
    } else if (event.type === 'assistant_message') {
      lines.push({ role: 'assistant', text: event.content, streaming: false });
    }
  }

  if (provisionalTranscript) {
    const latestUser = [...lines].reverse().find((line) => line.role === 'user');
    if (!latestUser || latestUser.text !== provisionalTranscript) {
      lines.push({ role: 'user', text: provisionalTranscript, streaming: true });
    }
  }

  const liveAssistant = streamingText.trim();
  if (liveAssistant) {
    lines.push({ role: 'assistant', text: liveAssistant, streaming: true });
  }
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 4;
  return lines.slice(-safeLimit);
}
