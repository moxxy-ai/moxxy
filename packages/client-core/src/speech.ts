/**
 * Markdown → speakable prose lives in `@moxxy/chat-model`, so the app, the TUI
 * and the messaging channels (Telegram, Discord) read a reply aloud alike.
 */
export { toSpeakableText, toVoiceConversationText } from '@moxxy/chat-model';
