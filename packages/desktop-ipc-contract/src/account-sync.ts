import { z } from 'zod/v3';

// These names resolve to portable credentials in the local encrypted vault.
export const syncKeyNames = [
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY',
  'GOOGLE_API_KEY', 'ELEVENLABS_API_KEY', 'DEEPSEEK_API_KEY', 'Z_AI_API_KEY', 'ZAI_API_KEY', 'TYPESAFE_API_KEY',
] as const;

export const portablePrefs = z.object({
  theme: z.enum(['light', 'dark', 'system']).optional(),
  voiceEngine: z.enum(['local', 'gpt-live']).optional(),
  replySound: z.boolean().optional(),
  inAppToasts: z.boolean().optional(),
  systemNotifications: z.boolean().optional(),
}).strict();

export const accountSnapshot = z.object({
  keys: z.record(z.enum(syncKeyNames), z.string().min(1).max(4096)).default({}),
  prefs: portablePrefs.default({}),
}).strict();

export type AccountSnapshot = z.infer<typeof accountSnapshot>;
export type SyncAction = 'save' | 'restore' | 'clear';
