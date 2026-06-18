/**
 * Public surface of the transport-agnostic client layer. The desktop renderer
 * and the Expo app both consume this barrel; each injects its own transport
 * (`./transport`) and platform capabilities (`./platform`) at boot.
 */

// Transport + platform injection seams.
export * from './transport.js';
export * from './platform.js';

// Pure utilities.
export * from './errors.js';
export * from './step-flow.js';
export * from './runner-retry.js';
export * from './speech.js';

// Chat model + stores.
export * from './chatModel.js';
export * from './chatStore.js';
export * from './chatPersistence.js';
export * from './askStore.js';

// Hooks.
export * from './useChat.js';
export * from './useConnection.js';
export * from './usePrefs.js';
export * from './useSettings.js';
export * from './useDesks.js';
export * from './useSessions.js';
export * from './useWorkflows.js';
export * from './usePausedWorkflows.js';
export * from './useWorkflowBuilder.js';
export * from './useActionCatalog.js';
export * from './useOnboarding.js';
export * from './useContextUsage.js';
export * from './useAppUpdate.js';
export * from './useMobileGateway.js';
export * from './useVoiceRecorder.js';
export * from './useActiveModeBadge.js';
export * from './useSessionInfoBridge.js';
export * from './useApps.js';
export * from './useAnonymizer.js';
