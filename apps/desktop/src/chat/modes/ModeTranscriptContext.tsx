import { createContext, useContext } from 'react';
import type { ModeNote, ModeOutcome, ModeTranscript } from './mode-events';

const NOTHING: ModeTranscript = { outcomes: new Map(), notes: new Map(), agentTitles: new Map(), openPlanId: null };

/** What the modes reported about the conversation on screen. Empty outside one. */
export const ModeTranscriptContext = createContext<ModeTranscript>(NOTHING);

/** The heading over an assistant message, when it closes a mode's work. */
export function useModeOutcome(messageId: string): ModeOutcome | undefined {
  return useContext(ModeTranscriptContext).outcomes.get(messageId);
}

/** The line a plugin event stands for, when it is a step worth saying. */
export function useModeNote(eventId: string): ModeNote | undefined {
  return useContext(ModeTranscriptContext).notes.get(eventId);
}

/** The question a research agent is answering. */
export function useAgentTitle(childSessionId: string): string | undefined {
  return useContext(ModeTranscriptContext).agentTitles.get(childSessionId);
}
