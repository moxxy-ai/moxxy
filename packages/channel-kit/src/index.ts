/**
 * @moxxy/channel-kit — shared machinery for building moxxy messaging channels.
 *
 * Extracted from the Telegram and Slack channel plugins so new channels
 * (Discord, WhatsApp, Signal, ...) are thin adapters: messenger-specific quirks
 * (formatting, transport error handling, signature schemes, pairing wording)
 * stay in each plugin; the load-bearing loop mechanics live here.
 */

export { FramePump, type FrameSink, type FramePumpOptions } from './frame-pump.js';
export {
  TurnCoordinator,
  driveTurn,
  subscribeTurn,
  type DriveTurnOptions,
  type TurnCoordinatorOptions,
  type TurnEventSource,
  type TurnLease,
  type TurnSession,
} from './turn.js';
export { PlainTurnRenderer } from './plain-turn-renderer.js';
export {
  clearHostCodePairing,
  createHostCodeState,
  greetPeer,
  isPeerAuthorized,
  openHostCodeWindow,
  submitPeerCode,
  type HostCodeAction,
  type HostCodeDecision,
  type HostCodePhase,
  type HostCodeState,
} from './pairing/host-code.js';
export { TofuPairingWindow, type TofuPairingWindowOptions } from './pairing/tofu.js';
export { resolveSecret, type SecretReader, type SecretSpec } from './secrets.js';
export {
  createAuditedAllowListResolver,
  type AuditedAllowListOptions,
} from './permission.js';
export {
  IngestHttpServer,
  respondJson,
  type IngestHttpServerHandle,
  type IngestHttpServerOptions,
  type IngestLogger,
  type IngestVerdict,
} from './ingest/http-server.js';
export { DeliveryDedupeCache } from './ingest/dedupe.js';
export {
  audioExtForMime,
  deliverVoiceReply,
  ensureOggOpus,
  resolveVoiceToggle,
  synthesizeReply,
  toSpeech,
  type DeliverVoiceReplyOptions,
  type EnsureOggOpusOptions,
  type EnsureOggOpusResult,
  type SynthesizeReplyOptions,
  type SynthesizeReplyResult,
  type SynthesizerSource,
  type VoiceReplyOutcome,
  type VoiceReplySink,
  type VoiceToggleInput,
  type VoiceToggleResult,
} from './voice-reply.js';
